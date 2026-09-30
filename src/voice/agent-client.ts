/**
 * Voice Agent API client (Plan Steps 14 & 17): one conversation with the stored agent.
 *
 * Protocol rules this class exists to get right (AssemblyAI docs, verified 2026-09-30):
 *  - first message binds the stored agent: `session.update { agent_id }`; audio flows only after `session.ready`
 *  - a client-side tool's `tool.result` must be sent when `reply.done` is the LATEST event received — not earlier
 *    (the agent is still mid-phrase) and not later (a new turn started)
 *  - a dropped socket can be resumed within 30 s with `session.resume { session_id }` on a fresh connection
 *  - always send `session.end` before closing, or the session lingers (and bills) for 30 s
 * Spec §9: one automatic reconnect; if that fails the session is FAILED and the caller must fail safe (hold).
 *
 * Sockets, playback and mic capture are injected so the whole thing is testable without a browser.
 */
import { PcmPlayer, base64ToPcm16, pcm16ToBase64, startPcmCapture, type Capture } from './audio';
import type { ToolOutcome } from './tools';
import type { TranscriptLine } from './types';

export const AGENT_WS_URL = 'wss://agents.assemblyai.com/v1/ws';
/** The Voice Agent API takes 24 kHz mono PCM16 in. */
export const AGENT_INPUT_RATE = 24_000;
const WS_OPEN = 1;
const RESUME_FAILED_CODES = new Set(['session_not_found', 'session_forbidden']);

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}
export interface PlayerLike {
  enqueue(pcm: Int16Array): void;
  flush(): void;
  close(): void;
}
export type SessionStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'failed';

export interface AgentSessionEvents {
  status(status: SessionStatus): void;
  transcript(line: TranscriptLine): void;
  /** Customer speech boundaries on the agent stream (wall-clock) — the Signal Engine's "customer windows". */
  speech(e: { kind: 'started' | 'stopped'; at: number }): void;
  /** Fires once, on the first `session.ready`: the moment to inject the transfer context. */
  ready(): void;
  /** The session cannot continue. The caller must fail safe. */
  fatal(reason: string): void;
}

export interface AgentSessionDeps {
  fetchToken: () => Promise<{ token: string; agentId: string }>;
  toolHandler: (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;
  createSocket?: (url: string) => SocketLike;
  createPlayer?: () => PlayerLike;
  startCapture?: (stream: MediaStream, rate: number, onFrame: (frame: { pcm: Int16Array }) => void) => Promise<Capture>;
  now?: () => number;
  /** How long a (re)connection may take to reach `session.ready`. */
  connectTimeoutMs?: number;
}

interface ServerMessage {
  type: string;
  session_id?: string;
  data?: string;
  text?: string;
  status?: string;
  code?: string;
  call_id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

export class AgentSession {
  private ws: SocketLike | null = null;
  private player: PlayerLike | null = null;
  private capture: Capture | null = null;
  private stream: MediaStream | null = null;
  private agentId = '';
  private sessionId: string | null = null;
  private lastEvent = '';
  private pending: { callId: string; outcome: ToolOutcome }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;
  private hasReconnected = false;
  private readyOnce = false;

  private readonly now: () => number;
  private readonly connectTimeoutMs: number;

  constructor(
    private readonly deps: AgentSessionDeps,
    private readonly events: AgentSessionEvents,
  ) {
    this.now = deps.now ?? Date.now;
    this.connectTimeoutMs = deps.connectTimeoutMs ?? 10_000;
  }

  // ---- lifecycle ---------------------------------------------------------------------------------

  /** Must be called from a user gesture (audio playback and the mic need one). */
  async start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    this.player = (this.deps.createPlayer ?? (() => new PcmPlayer()))();
    this.setStatus('connecting');
    await this.connect(false);
  }

  /** Ends the conversation cleanly. Safe to call more than once. */
  end(): void {
    if (this.closing) return;
    this.closing = true;
    if (this.ws?.readyState === WS_OPEN) this.send({ type: 'session.end' }); // else the server holds the session 30 s
    this.cleanup();
    this.setStatus('ended');
  }

  private cleanup() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.capture?.stop();
    this.capture = null;
    this.player?.close();
    this.player = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onmessage = ws.onclose = ws.onerror = ws.onopen = null;
      ws.close();
    }
  }

  private fail(reason: string) {
    if (this.closing) return;
    this.closing = true;
    this.cleanup();
    this.setStatus('failed');
    this.events.fatal(reason);
  }

  private setStatus(status: SessionStatus) {
    this.events.status(status);
  }

  // ---- connection --------------------------------------------------------------------------------

  private async connect(resume: boolean): Promise<void> {
    let token: string;
    try {
      ({ token, agentId: this.agentId } = await this.deps.fetchToken());
    } catch {
      return this.fail('could not get a session token');
    }
    if (this.closing) return;

    const ws = (this.deps.createSocket ?? ((u) => new WebSocket(u) as unknown as SocketLike))(`${AGENT_WS_URL}?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () =>
      ws.send(
        JSON.stringify(
          resume && this.sessionId
            ? { type: 'session.resume', session_id: this.sessionId }
            : { type: 'session.update', session: { agent_id: this.agentId } },
        ),
      );
    ws.onmessage = (e) => this.handle(JSON.parse(e.data) as ServerMessage);
    ws.onclose = () => this.onClose(ws);
    ws.onerror = () => {}; // a close always follows; it is handled there

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail('timed out connecting to the voice agent'), this.connectTimeoutMs);
  }

  private onClose(ws: SocketLike) {
    if (ws !== this.ws || this.closing) return;
    if (this.hasReconnected) return this.fail('connection lost');
    this.hasReconnected = true;
    this.setStatus('reconnecting');
    void this.connect(true);
  }

  // ---- messages from the server ------------------------------------------------------------------

  private handle(msg: ServerMessage) {
    if (this.closing) return;
    this.lastEvent = msg.type; // "latest event" is what the tool-result rule is judged against

    switch (msg.type) {
      case 'session.ready':
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.sessionId = msg.session_id ?? this.sessionId;
        this.setStatus('live');
        void this.startCapture();
        if (!this.readyOnce) {
          this.readyOnce = true;
          this.events.ready();
        }
        break;
      case 'input.speech.started':
        this.events.speech({ kind: 'started', at: this.now() });
        break;
      case 'input.speech.stopped':
        this.events.speech({ kind: 'stopped', at: this.now() });
        break;
      case 'reply.audio':
        if (msg.data) this.player?.enqueue(base64ToPcm16(msg.data));
        break;
      case 'reply.done':
        if (msg.status === 'interrupted') this.player?.flush(); // barge-in: never play stale speech
        this.flushPending();
        break;
      case 'transcript.user':
        this.events.transcript({ role: 'customer', text: msg.text ?? '', at: this.now() });
        break;
      case 'transcript.agent':
        this.events.transcript({ role: 'agent', text: msg.text ?? '', at: this.now() });
        break;
      case 'tool.call':
        void this.runTool(msg);
        break;
      case 'session.error':
        // A failed resume is final; other errors are followed by a close, which the reconnect logic handles.
        if (msg.code && RESUME_FAILED_CODES.has(msg.code)) this.fail('could not resume the voice session');
        break;
    }
  }

  private async startCapture() {
    if (this.capture || !this.stream) return; // already running (a resume reuses the same capture)
    const start = this.deps.startCapture ?? startPcmCapture;
    this.capture = await start(this.stream, AGENT_INPUT_RATE, (frame) => {
      if (this.ws?.readyState === WS_OPEN) this.send({ type: 'input.audio', audio: pcm16ToBase64(frame.pcm) });
    });
  }

  // ---- tools -------------------------------------------------------------------------------------

  private async runTool(msg: ServerMessage) {
    let outcome: ToolOutcome;
    try {
      outcome = await this.deps.toolHandler(msg.name ?? '', msg.arguments ?? {});
    } catch {
      outcome = { result: { error: 'This could not be completed right now.' }, isError: true };
    }
    if (this.closing || !msg.call_id) return;
    this.pending.push({ callId: msg.call_id, outcome });
    this.flushPending(); // the tool may finish AFTER reply.done already arrived
  }

  private flushPending() {
    if (this.lastEvent !== 'reply.done' || this.pending.length === 0) return;
    for (const { callId, outcome } of this.pending) {
      this.send({
        type: 'tool.result',
        call_id: callId,
        result: JSON.stringify(outcome.result),
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }
    this.pending = [];
  }

  // ---- messages to the server --------------------------------------------------------------------

  /** Trusted context for the agent (conversation.message, role "system"). The agent does not reply to it. */
  sendSystemMessage(text: string) {
    this.send({ type: 'conversation.message', role: 'system', content: text });
  }

  /** Makes the agent speak now, guided by one-shot instructions. */
  requestReply(instructions: string) {
    this.send({ type: 'reply.create', instructions });
  }

  private send(message: object) {
    if (this.ws?.readyState === WS_OPEN) this.ws.send(JSON.stringify(message));
  }
}
