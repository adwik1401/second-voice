/**
 * Room Listener (Plan Step 18): the SECOND AssemblyAI stream. The same shared mic feeds Realtime STT with speaker
 * labels, so the system also hears everything said in the room — including speech the agent stream's noise
 * suppression filters out. Each word is tagged with its loudness (dBFS) from the 50 ms RMS frames we send.
 *
 * It fails SOFT: a room stream is supporting evidence, never the main path. Any failure (no token, rejected
 * connection, dropped socket) becomes status `unavailable` and the Voice Check carries on with the agent stream.
 *
 * Protocol (AssemblyAI docs, verified 2026-09-30): connect with a temporary `token`; send raw PCM16 as binary
 * frames after `Begin`; finalised turns arrive as `Turn { end_of_turn: true, transcript, speaker_label, words }`;
 * send `Terminate` to end (a bare close bills until the server times out).
 */
import { DEFAULT_FRAME_MS, wordDbfs } from '../core/loudness';
import type { RoomTurn, RoomWord } from '../core/types';
import type { SocketLike } from './agent-client';
import { startPcmCapture, type Capture } from './audio';
import type { RoomStatus } from './types';

export const STT_WS_URL = 'wss://streaming.assemblyai.com/v3/ws';
/** Realtime STT takes 16 kHz mono PCM16 by default. */
export const ROOM_SAMPLE_RATE = 16_000;
const WS_OPEN = 1;

export interface RoomListenerEvents {
  status(status: RoomStatus): void;
  /** A finalised turn, with per-word loudness. `roomStartMs` converts word offsets to wall-clock time. */
  turn(turn: RoomTurn, roomStartMs: number): void;
}

export interface RoomListenerDeps {
  fetchToken: () => Promise<string>;
  createSocket?: (url: string) => SocketLike;
  startCapture?: (stream: MediaStream, rate: number, onFrame: (frame: { pcm: Int16Array; rms: number }) => void) => Promise<Capture>;
  now?: () => number;
  connectTimeoutMs?: number;
}

interface SttMessage {
  type: string;
  end_of_turn?: boolean;
  transcript?: string;
  speaker_label?: string;
  words?: { text: string; start: number; end: number; speaker?: string }[];
  error?: string;
}

export class RoomListener {
  private ws: SocketLike | null = null;
  private capture: Capture | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;
  /** RMS of every 50 ms frame sent; index i covers audio time [i·50, (i+1)·50) ms — the clock word timings use. */
  private frameRms: number[] = [];
  private roomStartMs: number | null = null;
  private readonly now: () => number;

  constructor(
    private readonly deps: RoomListenerDeps,
    private readonly events: RoomListenerEvents,
  ) {
    this.now = deps.now ?? Date.now;
  }

  async start(stream: MediaStream): Promise<void> {
    this.events.status('connecting');
    let token: string;
    try {
      token = await this.deps.fetchToken();
    } catch {
      return this.unavailable();
    }
    if (this.closing) return;

    const params = new URLSearchParams({
      token,
      speech_model: 'universal-3-6-pro',
      sample_rate: String(ROOM_SAMPLE_RATE),
      speaker_labels: 'true',
      max_speakers: '3',
    });
    const ws = (this.deps.createSocket ?? ((u) => new WebSocket(u) as unknown as SocketLike))(`${STT_WS_URL}?${params}`);
    this.ws = ws;
    ws.onmessage = (e) => void this.handle(JSON.parse(e.data as string) as SttMessage, stream);
    ws.onclose = () => {
      if (!this.closing) this.unavailable();
    };
    ws.onerror = () => {}; // a close follows

    this.timer = setTimeout(() => this.unavailable(), this.deps.connectTimeoutMs ?? 10_000);
  }

  private async handle(msg: SttMessage, stream: MediaStream) {
    if (this.closing) return;
    if (msg.type === 'Begin') {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      const start = this.deps.startCapture ?? startPcmCapture;
      // Audio is sent only after Begin, so audio time 0 is the first frame — which keeps word timings aligned with frameRms.
      this.capture = await start(stream, ROOM_SAMPLE_RATE, (frame) => {
        if (this.ws?.readyState !== WS_OPEN) return;
        if (this.roomStartMs === null) this.roomStartMs = this.now();
        this.ws.send(frame.pcm.buffer as ArrayBuffer);
        this.frameRms.push(frame.rms);
      });
      this.events.status('live');
    } else if (msg.type === 'Turn' && msg.end_of_turn) {
      this.emitTurn(msg);
    } else if (msg.type === 'Error' || msg.error) {
      this.unavailable();
    }
  }

  private emitTurn(msg: SttMessage) {
    const speaker = msg.speaker_label ?? '?';
    // Some finalised turns arrive with text but no per-word data (seen live); keep the text, without loudness.
    const words: RoomWord[] = msg.words?.length
      ? msg.words.map((w) => ({ text: w.text, start: w.start, end: w.end, speaker: w.speaker ?? speaker, dbfs: wordDbfs(w, this.frameRms, DEFAULT_FRAME_MS) }))
      : (msg.transcript ?? '').split(/\s+/).filter(Boolean).map((text) => ({ text, speaker, dbfs: null }));
    if (words.length === 0) return;
    this.events.turn({ at: this.now(), speaker, words }, this.roomStartMs ?? this.now());
  }

  /** Ends the stream cleanly (Terminate before close). Safe to call more than once. */
  end(): void {
    if (this.closing) return;
    this.closing = true;
    if (this.ws?.readyState === WS_OPEN) this.ws.send(JSON.stringify({ type: 'Terminate' }));
    this.cleanup();
  }

  private unavailable() {
    if (this.closing) return;
    this.closing = true;
    this.cleanup();
    this.events.status('unavailable');
  }

  private cleanup() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.capture?.stop();
    this.capture = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onmessage = ws.onclose = ws.onerror = ws.onopen = null;
      ws.close();
    }
  }
}
