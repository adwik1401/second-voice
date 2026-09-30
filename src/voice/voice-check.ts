/**
 * VoiceCheck: one customer's live check of one transfer (Plan Steps 13–17). Owns the mic, the agent session and
 * the CheckState, and is the single object the UI watches (`subscribe`).
 *
 * What it does with every CUSTOMER line heard on the agent stream:
 *   1. mines it for pressure cues and hard triggers (analysis.ts)
 *   2. asks the detector whether it reads as coaching — run 4 showed a coach's words arrive here as "customer" lines
 *   3. on confident coaching (≥ 0.7): records the evidence and has the agent ask one gentle question (rate-limited)
 *   4. checks whether it repeats an earlier coach utterance — the strongest signal (echo)
 * Fail-safe (spec §9): mic denied, token failure, or a session that cannot be resumed → the check concludes with a
 * HOLD, never a release.
 */
import { detectEcho } from '../core/signal-engine';
import type { ConversationTurn, TimeWindow } from '../core/types';
import { AgentSession, type AgentSessionDeps, type AgentSessionEvents, type SessionStatus } from './agent-client';
import { openMic } from './audio';
import { CheckState } from './check-state';
import { detectCoaching, type DetectInput, type DetectResult } from './detect-client';
import { AgentInjector, transferContext } from './injector';
import { fetchAgentToken } from './token';
import { createToolRunner } from './tools';
import type { CopInfo, ProfileInfo, TranscriptLine, TransferIntent } from './types';

/** Coaching is acted on at this confidence — the same floor the risk scorer uses. */
const ACT_CONFIDENCE = 0.7;
const DETECT_CONTEXT_LINES = 12;

export interface SessionLike {
  start(stream: MediaStream): Promise<void>;
  end(): void;
  sendSystemMessage(text: string): void;
  requestReply(instructions: string): void;
}

export interface VoiceCheckDeps {
  fetchImpl?: typeof fetch;
  openMic?: () => Promise<MediaStream>;
  createSession?: (deps: Pick<AgentSessionDeps, 'fetchToken' | 'toolHandler'>, events: AgentSessionEvents) => SessionLike;
  detect?: (input: DetectInput) => Promise<DetectResult>;
  now?: () => number;
}

/** One shared stream feeds every consumer: AEC on removes the agent's own voice; NS/AGC off keeps faint speech (spike runs 3–4). */
const defaultOpenMic = () => openMic({ echoCancellation: true, noiseSuppression: false, autoGainControl: false });

export class VoiceCheck {
  readonly state: CheckState;
  readonly transcript: TranscriptLine[] = [];
  /** Wall-clock windows in which the agent stream heard the customer speaking (input for the Signal Engine). */
  readonly customerWindows: TimeWindow[] = [];
  status: SessionStatus = 'idle';
  /** Set when the check could not run normally; the outcome is then a hold. */
  failureReason: string | null = null;

  private stream: MediaStream | null = null;
  private session: SessionLike | null = null;
  private injector: AgentInjector | null = null;
  private openWindowStart: number | null = null;
  private readonly coachUtterances: { text: string; at: number }[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(
    readonly transfer: TransferIntent,
    prefetched: { profile?: ProfileInfo; cop?: CopInfo } = {},
    private readonly deps: VoiceCheckDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
    this.state = new CheckState(transfer);
    // Already fetched by the transfer form: no need to ask the agent's tools to fetch them again.
    if (prefetched.profile) this.state.setProfile(prefetched.profile);
    if (prefetched.cop) this.state.setCop(prefetched.cop);
    this.state.subscribe(() => this.emit());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  /** The conversation so far, in the shape the Signal Engine consumes. */
  get conversation(): ConversationTurn[] {
    return this.transcript.map((l) => ({ at: l.at, role: l.role, text: l.text }));
  }

  // ---- lifecycle ---------------------------------------------------------------------------------

  /** Call from a click handler: the mic prompt and audio playback both need a user gesture. */
  async start(): Promise<void> {
    this.setStatus('connecting');
    try {
      this.stream = await (this.deps.openMic ?? defaultOpenMic)();
    } catch {
      return this.failSafe('microphone unavailable');
    }

    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const toolHandler = createToolRunner(this.state, { fetchImpl, now: this.now });
    const events: AgentSessionEvents = {
      status: (s) => this.setStatus(s),
      transcript: (line) => this.onTranscript(line),
      speech: (e) => this.onSpeech(e),
      ready: () => this.injector?.context(transferContext(this.transfer)),
      fatal: (reason) => this.failSafe(reason),
    };
    const fetchToken = () => fetchAgentToken(fetchImpl);
    this.session = (this.deps.createSession ?? ((d, e) => new AgentSession({ ...d, now: this.now }, e)))({ fetchToken, toolHandler }, events);
    this.injector = new AgentInjector(
      { systemMessage: (t) => this.session?.sendSystemMessage(t), replyNow: (i) => this.session?.requestReply(i) },
      this.now,
    );
    await this.session.start(this.stream);
  }

  /** Ends the conversation and releases the microphone. Safe to call more than once. */
  end(): void {
    this.session?.end();
    this.stopMic();
    if (this.status !== 'failed') this.setStatus('ended');
  }

  private failSafe(reason: string) {
    this.failureReason = reason;
    this.session?.end();
    this.stopMic();
    this.status = 'failed';
    this.state.decideInterrupted(); // a hold, never a release; emits via the state subscription
    this.emit();
  }

  private stopMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private setStatus(status: SessionStatus) {
    this.status = status;
    this.emit();
  }

  // ---- what the session reports ------------------------------------------------------------------

  private onSpeech(e: { kind: 'started' | 'stopped'; at: number }) {
    if (e.kind === 'started') this.openWindowStart = e.at;
    else if (this.openWindowStart !== null) {
      this.customerWindows.push({ start: this.openWindowStart, end: e.at });
      this.openWindowStart = null;
    }
    this.emit();
  }

  private onTranscript(line: TranscriptLine) {
    this.transcript.push(line);
    if (line.role === 'customer') {
      this.state.absorbCustomerText(line.text);
      void this.analyze(line);
    }
    this.emit();
  }

  private async analyze(line: TranscriptLine) {
    const detect = this.deps.detect ?? ((input: DetectInput) => detectCoaching(input, this.deps.fetchImpl));
    const purpose = this.state.answers.filter((a) => a.topic === 'purpose').at(-1)?.answer;
    const verdict = await detect({
      utterances: [{ source: 'agent_stream', text: line.text }],
      recentConversation: this.transcript.slice(-DETECT_CONTEXT_LINES),
      transfer: { amountGBP: this.transfer.amountGBP, payeeName: this.transfer.payee.name, ...(purpose ? { purpose } : {}) },
    });

    // Echo first, against EARLIER coach utterances (this line cannot echo itself).
    this.checkEcho(line);

    if (verdict.isCoaching && verdict.confidence >= ACT_CONFIDENCE) {
      this.state.noteCoaching({ at: line.at, source: verdict.source, type: verdict.type, quote: verdict.quote, confidence: verdict.confidence });
      this.coachUtterances.push({ text: line.text, at: line.at });
      // Evidence is always recorded; the injector only speaks up once per 20 s.
      this.injector?.coachingDetected(verdict.type, verdict.quote);
    }
  }

  private checkEcho(line: TranscriptLine) {
    if (this.state.echo) return;
    for (const coach of this.coachUtterances) {
      const echo = detectEcho(coach, this.conversation);
      if (echo.isEcho) {
        this.state.noteEcho({ at: line.at, source: 'echo', type: 'echo', quote: echo.customerText ?? '', confidence: echo.ratio });
        return;
      }
    }
  }
}
