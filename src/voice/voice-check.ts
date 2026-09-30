/**
 * VoiceCheck: one customer's live check of one transfer (Plan Steps 13–19). Owns the mic, the agent session, the
 * room listener and the CheckState, and is the single object the UI watches (`subscribe`).
 *
 * Two streams feed one set of evidence:
 *  - AGENT stream (Voice Agent API): every customer line is mined for pressure cues and hard triggers, checked for
 *    coaching language, and checked for echo. Run 4 showed a coach's words arrive here as "customer" lines.
 *  - ROOM stream (Realtime STT, same mic): room words nobody on the call accounts for are "room-only speech";
 *    each finished run is checked for coaching language too. Its failure never affects the check.
 * On confident coaching (≥ 0.7) the agent is told (trusted system message) and asks ONE gentle question, at most
 * once per 20 s. Fail-safe (spec §9): mic denied, token failure, or a session that cannot be resumed → the check
 * concludes with a HOLD, never a release.
 */
import type { ConversationTurn, RoomTurn, TimeWindow } from '../core/types';
import { detectEcho, findRoomOnlySpeech, type RoomUtterance } from '../core/signal-engine';
import { contentOverlap } from '../core/text-match';
import { AgentSession, type AgentSessionDeps, type AgentSessionEvents, type SessionStatus } from './agent-client';
import { openMic } from './audio';
import { CheckState } from './check-state';
import { detectCoaching, type DetectInput, type DetectResult } from './detect-client';
import { AgentInjector, transferContext } from './injector';
import { RoomListener, type RoomListenerEvents } from './room-listener';
import { fetchAgentToken, fetchSttToken } from './token';
import { createToolRunner } from './tools';
import type { CopInfo, ProfileInfo, RoomLine, RoomStatus, TranscriptLine, TransferIntent } from './types';

/** Coaching is acted on at this confidence — the same floor the risk scorer uses. */
const ACT_CONFIDENCE = 0.7;
const DETECT_CONTEXT_LINES = 12;
/**
 * A room turn is judged only after this delay: the agent stream's transcript of the same speech arrives a little
 * later than the room stream's, and judging sooner would call the customer's own words "room-only" (spike run 2).
 */
const ROOM_SETTLE_MS = 2500;
/** The same coach audio is heard by both streams; evidence within this window with this much overlap is one event. */
const SAME_AUDIO_WINDOW_MS = 6000;
const SAME_AUDIO_OVERLAP = 0.6;

export interface SessionLike {
  start(stream: MediaStream): Promise<void>;
  end(): void;
  sendSystemMessage(text: string): void;
  requestReply(instructions: string): void;
}
export interface RoomLike {
  start(stream: MediaStream): Promise<void>;
  end(): void;
}

export interface VoiceCheckDeps {
  fetchImpl?: typeof fetch;
  openMic?: () => Promise<MediaStream>;
  createSession?: (deps: Pick<AgentSessionDeps, 'fetchToken' | 'toolHandler'>, events: AgentSessionEvents) => SessionLike;
  /** Pass `null` to run without a room stream. */
  createRoom?: ((deps: { fetchToken: () => Promise<string> }, events: RoomListenerEvents) => RoomLike) | null;
  detect?: (input: DetectInput) => Promise<DetectResult>;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => void;
  roomSettleMs?: number;
}

/** One shared stream feeds every consumer: AEC on removes the agent's own voice; NS/AGC off keeps faint speech (spike runs 3–4). */
const defaultOpenMic = () => openMic({ echoCancellation: true, noiseSuppression: false, autoGainControl: false });

export class VoiceCheck {
  readonly state: CheckState;
  readonly transcript: TranscriptLine[] = [];
  /** The room stream (Realtime STT) — what the whole room heard; populated while it is connected. */
  roomStatus: RoomStatus = 'off';
  readonly roomLines: RoomLine[] = [];
  /** Wall-clock windows in which the agent stream heard the customer speaking (input for the Signal Engine). */
  readonly customerWindows: TimeWindow[] = [];
  status: SessionStatus = 'idle';
  /** Shown to the customer if the payment is held, so they can quote it to the colleague who calls. */
  readonly reference = `LRK-${Math.floor(1000 + Math.random() * 9000)}`;
  /** Set when the check could not run normally; the outcome is then a hold. */
  failureReason: string | null = null;

  private stream: MediaStream | null = null;
  private session: SessionLike | null = null;
  private room: RoomLike | null = null;
  private injector: AgentInjector | null = null;
  private openWindowStart: number | null = null;
  private readonly coachUtterances: { text: string; at: number }[] = [];
  private readonly roomTurns: RoomTurn[] = [];
  private roomStartMs = 0;
  private readonly reportedRoomRuns = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private changes = 0;

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
    this.changes++;
    for (const l of this.listeners) l();
  }

  /** Increments on every change — a cheap, stable snapshot for React's useSyncExternalStore. */
  get version(): number {
    return this.changes;
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
    this.startRoom(fetchImpl);
  }

  /** The room stream is supporting evidence: started after the agent, and any failure only marks it unavailable. */
  private startRoom(fetchImpl: typeof fetch) {
    if (this.deps.createRoom === null || !this.stream || this.status === 'failed') return;
    const events: RoomListenerEvents = {
      status: (s) => {
        this.roomStatus = s;
        this.emit();
      },
      turn: (turn, roomStartMs) => this.onRoomTurn(turn, roomStartMs),
    };
    const fetchToken = () => fetchSttToken(fetchImpl);
    this.room = (this.deps.createRoom ?? ((d, e) => new RoomListener({ ...d, now: this.now }, e)))({ fetchToken }, events);
    void this.room.start(this.stream).catch(() => {
      this.roomStatus = 'unavailable';
      this.emit();
    });
  }

  /** "I'd rather speak to a person": ends the call and concludes with a hold and a human. No-op once decided. */
  requestHuman(): void {
    if (this.state.decision) return;
    this.state.requestHuman('customer asked for a person');
    this.session?.end();
    this.room?.end();
    this.stopMic();
    this.status = 'ended';
    this.state.decideInterrupted('The customer asked to speak to a person, so the payment is held');
    this.emit();
  }

  /** Ends the conversation and releases the microphone. Safe to call more than once. */
  end(): void {
    this.session?.end();
    this.room?.end();
    this.stopMic();
    if (this.status !== 'failed') this.setStatus('ended');
  }

  private failSafe(reason: string) {
    this.failureReason = reason;
    this.session?.end();
    this.room?.end();
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

  // ---- agent stream ------------------------------------------------------------------------------

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

  private detect(input: DetectInput): Promise<DetectResult> {
    return (this.deps.detect ?? ((i: DetectInput) => detectCoaching(i, this.deps.fetchImpl)))(input);
  }

  private detectInput(source: 'agent_stream' | 'room_stream', text: string): DetectInput {
    const purpose = this.state.answers.filter((a) => a.topic === 'purpose').at(-1)?.answer;
    return {
      utterances: [{ source, text }],
      recentConversation: this.transcript.slice(-DETECT_CONTEXT_LINES),
      transfer: { amountGBP: this.transfer.amountGBP, payeeName: this.transfer.payee.name, ...(purpose ? { purpose } : {}) },
    };
  }

  private async analyze(line: TranscriptLine) {
    const verdict = await this.detect(this.detectInput('agent_stream', line.text));
    // Echo first, against EARLIER coach utterances (this line cannot echo itself).
    this.checkEcho(line.at);
    this.recordCoaching(line.text, line.at, verdict);
  }

  // ---- room stream -------------------------------------------------------------------------------

  private onRoomTurn(turn: RoomTurn, roomStartMs: number) {
    this.roomStartMs = roomStartMs;
    const index = this.roomTurns.length;
    this.roomTurns.push(turn);
    this.roomLines.push({ at: turn.at, speaker: turn.speaker, text: turn.words.map((w) => w.text).join(' '), flagged: false });
    this.emit();
    (this.deps.schedule ?? ((fn, ms) => void setTimeout(fn, ms)))(() => void this.evaluateRoom(index), this.deps.roomSettleMs ?? ROOM_SETTLE_MS);
  }

  /** Judges a room turn once the agent stream has had time to explain the customer's own words. */
  private async evaluateRoom(turnIndex: number) {
    const runs = findRoomOnlySpeech({
      roomTurns: this.roomTurns,
      conversation: this.conversation,
      customerSpeechWindows: this.customerWindows,
      roomStartMs: this.roomStartMs,
    }).filter((u) => u.turnIndex === turnIndex && !this.reportedRoomRuns.has(`${u.turnIndex}:${u.text}`));

    for (const run of runs) {
      this.reportedRoomRuns.add(`${run.turnIndex}:${run.text}`);
      await this.judgeRoomRun(run);
    }
  }

  private async judgeRoomRun(run: RoomUtterance) {
    const at = this.roomTurns[run.turnIndex].at;
    // The content cue is the core signal: a run of unexplained words is checked for coaching language whether or not
    // a tie-breaker (different speaker / far loudness) agrees.
    const verdict = await this.detect(this.detectInput('room_stream', run.text));
    const coaching = verdict.isCoaching && verdict.confidence >= ACT_CONFIDENCE;

    if (run.qualifies) {
      this.state.noteRoomOnly({ at, source: 'room_only', type: run.differentSpeaker ? 'different_speaker' : 'far_loudness', quote: run.text, confidence: 0.5 });
    }
    if (run.qualifies || coaching) this.flagRoomLine(run.turnIndex);
    this.recordCoaching(run.text, at, verdict);
  }

  private flagRoomLine(turnIndex: number) {
    if (this.roomLines[turnIndex]) this.roomLines[turnIndex].flagged = true;
    this.emit();
  }

  // ---- shared evidence handling ------------------------------------------------------------------

  /** Records confident coaching, once per real-world utterance even when both streams heard it. */
  private recordCoaching(text: string, at: number, verdict: DetectResult) {
    if (!(verdict.isCoaching && verdict.confidence >= ACT_CONFIDENCE)) return;
    const sameAudio = this.coachUtterances.some((c) => {
      if (Math.abs(c.at - at) > SAME_AUDIO_WINDOW_MS) return false;
      const o = contentOverlap(c.text, text);
      return o.matched >= 1 && o.ratio >= SAME_AUDIO_OVERLAP;
    });
    if (sameAudio) return;

    this.state.noteCoaching({ at, source: verdict.source, type: verdict.type, quote: verdict.quote, confidence: verdict.confidence });
    this.coachUtterances.push({ text, at });
    // Evidence is always recorded; the injector only speaks up once per 20 s.
    this.injector?.coachingDetected(verdict.type, verdict.quote);
  }

  private checkEcho(at: number) {
    if (this.state.echo) return;
    for (const coach of this.coachUtterances) {
      const echo = detectEcho(coach, this.conversation);
      if (echo.isEcho) {
        this.state.noteEcho({ at, source: 'echo', type: 'echo', quote: echo.customerText ?? '', confidence: echo.ratio });
        return;
      }
    }
  }
}
