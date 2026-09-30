/**
 * Phase 0 spike session: the two live AssemblyAI connections the whole design depends on.
 *
 *   Mic A (echo-cancel ON)            ──► Voice Agent API   (the conversation; agent hears the customer)
 *   Mic B (echo-cancel ON, NS/AGC OFF) ──► Realtime STT      (the room; speaker labels + per-frame loudness)
 *
 * The spike answers: can one laptop mic give us both a clean customer stream and a room stream
 * faint enough voices survive in — and does the loudness/diarization evidence separate a whisperer?
 */
import { FRAME_MS, PcmPlayer, base64ToPcm16, openMic, pcm16ToBase64, startPcmCapture, type Capture } from '../voice/audio';
import { wordDbfs } from './metrics';

export interface RoomWord {
  text: string;
  speaker: string;
  dbfs: number | null;
}
export interface RoomTurn {
  /** Wall-clock arrival time, used to line this turn up with the agent stream's transcripts. */
  at: number;
  speaker: string;
  text: string;
  words: RoomWord[];
}
export interface AgentLine {
  at: number;
  role: 'agent' | 'customer';
  text: string;
}

export interface SessionEvents {
  status: (msg: string) => void;
  constraints: (micA: MediaTrackSettings, micB: MediaTrackSettings) => void;
  roomPartial: (text: string) => void;
  roomTurn: (turn: RoomTurn) => void;
  agentLine: (line: AgentLine) => void;
  /** ms from the customer finishing speaking to the first audio of the agent's reply. */
  latency: (ms: number) => void;
  error: (msg: string) => void;
}

// Shapes of the server messages we read (only the fields we use).
interface SttTurn {
  type: 'Turn';
  end_of_turn: boolean;
  transcript: string;
  speaker_label?: string;
  words?: { text: string; start: number; end: number; speaker?: string }[];
}
interface AgentEvent {
  type: string;
  data?: string;
  text?: string;
  status?: string;
  message?: string;
  code?: string;
}

async function fetchToken(kind: 'agent' | 'stt'): Promise<string> {
  const res = await fetch(`/api/token/${kind}`);
  if (!res.ok) {
    throw new Error(
      res.status === 500
        ? 'Server has no ASSEMBLYAI_API_KEY — put it in .env.local and restart `npm run dev`.'
        : `Token request for ${kind} failed (HTTP ${res.status}).`,
    );
  }
  return ((await res.json()) as { token: string }).token;
}

export class SpikeSession {
  private captures: Capture[] = [];
  private streams: MediaStream[] = [];
  /** Each socket remembers the message that ends *its* protocol (they differ per product). */
  private sockets: { ws: WebSocket; endMessage: string }[] = [];
  private player: PcmPlayer | null = null;
  /** RMS of every 50 ms frame sent to the room STT; index i ↔ audio time [i·50, (i+1)·50) ms. */
  private roomRms: number[] = [];
  private speechStoppedAt: number | null = null;

  constructor(
    private agentId: string,
    /**
     * true  → ONE mic stream (AEC on, NS/AGC off) feeds both connections. Preferred: the probe showed Chrome grants
     *         this combination, whereas opening a second, differently-constrained stream on the same device made
     *         Chrome silently switch echo cancellation OFF for it (spike run 3).
     * false → the original two-stream experiment (Mic A default processing, Mic B raw).
     */
    private opts: { sharedMic: boolean; agc: boolean },
    private ev: SessionEvents,
  ) {}

  async start(): Promise<void> {
    this.ev.status('Fetching tokens…');
    const [agentToken, sttToken] = await Promise.all([fetchToken('agent'), fetchToken('stt')]);

    let micA: MediaStream;
    let micB: MediaStream;
    if (this.opts.sharedMic) {
      // AGC is the range lever: with it off a distant voice stays faint; with it on Chrome boosts it.
      micA = micB = await openMic({ echoCancellation: true, noiseSuppression: false, autoGainControl: this.opts.agc });
      this.streams.push(micA);
    } else {
      // Two streams from one device with deliberately different processing; the browser may ignore the difference.
      micA = await openMic({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      micB = await openMic({ echoCancellation: true, noiseSuppression: false, autoGainControl: false });
      this.streams.push(micA, micB);
    }
    this.ev.constraints(micA.getAudioTracks()[0].getSettings(), micB.getAudioTracks()[0].getSettings());

    this.player = new PcmPlayer(); // created inside the click handler → allowed to autoplay
    this.openRoom(sttToken, micB);
    this.openAgent(agentToken, micA);
  }

  // ---- Room stream: Mic B → Realtime STT (speaker labels) --------------------------------------

  private openRoom(token: string, mic: MediaStream): void {
    const params = new URLSearchParams({
      token,
      speech_model: 'universal-3-6-pro',
      sample_rate: '16000',
      speaker_labels: 'true',
      max_speakers: '3',
    });
    const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`);
    this.sockets.push({ ws, endMessage: JSON.stringify({ type: 'Terminate' }) });

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data as string) as { type: string; error?: string };
      if (msg.type === 'Begin') {
        this.ev.status('Room stream live.');
        // Start sending only after Begin so audio time 0 == first frame (keeps word timings aligned with roomRms).
        this.captures.push(
          await startPcmCapture(mic, 16000, (frame) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send(frame.pcm.buffer as ArrayBuffer);
            this.roomRms.push(frame.rms);
          }),
        );
      } else if (msg.type === 'Turn') {
        this.onRoomTurn(msg as unknown as SttTurn);
      } else if (msg.type === 'Error' || msg.error) {
        this.ev.error(`Room STT: ${e.data}`);
      }
    };
    ws.onerror = () => this.ev.error('Room STT WebSocket error.');
  }

  private onRoomTurn(turn: SttTurn): void {
    if (!turn.end_of_turn) return this.ev.roomPartial(turn.transcript);
    this.ev.roomPartial('');
    const speaker = turn.speaker_label ?? '?';
    this.ev.roomTurn({
      at: Date.now(),
      speaker,
      text: turn.transcript,
      // Run 4: some finalised turns arrived with a transcript but no per-word data and rendered as a blank
      // "[?]" line, hiding what the room heard. Fall back to the transcript text (no loudness available).
      words: turn.words?.length
        ? turn.words.map((w) => ({
            text: w.text,
            speaker: w.speaker ?? speaker,
            dbfs: wordDbfs(w, this.roomRms, FRAME_MS),
          }))
        : turn.transcript
            .split(/\s+/)
            .filter(Boolean)
            .map((text) => ({ text, speaker, dbfs: null })),
    });
  }

  // ---- Agent stream: Mic A → Voice Agent API ----------------------------------------------------

  private openAgent(token: string, mic: MediaStream): void {
    const ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${token}`);
    this.sockets.push({ ws, endMessage: JSON.stringify({ type: 'session.end' }) });
    ws.onopen = () => ws.send(JSON.stringify({ type: 'session.update', session: { agent_id: this.agentId } }));

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data as string) as AgentEvent;
      switch (msg.type) {
        case 'session.ready':
          this.ev.status('Agent live — say hello.');
          this.captures.push(
            await startPcmCapture(mic, 24000, (frame) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              ws.send(JSON.stringify({ type: 'input.audio', audio: pcm16ToBase64(frame.pcm) }));
            }),
          );
          break;
        case 'input.speech.stopped':
          this.speechStoppedAt = performance.now();
          break;
        case 'reply.audio':
          if (msg.data) this.player?.enqueue(base64ToPcm16(msg.data));
          if (this.speechStoppedAt !== null) {
            const ms = Math.round(performance.now() - this.speechStoppedAt);
            this.speechStoppedAt = null;
            // Run 6 logged two 0 ms samples: audio of an earlier reply was still streaming when a fresh
            // speech.stopped arrived. No real reply starts within 200 ms, so treat those as glitches.
            if (ms >= 200) this.ev.latency(ms);
          }
          break;
        case 'reply.done':
          if (msg.status === 'interrupted') this.player?.flush(); // barge-in: drop stale speech
          break;
        case 'transcript.user':
          this.ev.agentLine({ at: Date.now(), role: 'customer', text: msg.text ?? '' });
          break;
        case 'transcript.agent':
          this.ev.agentLine({ at: Date.now(), role: 'agent', text: msg.text ?? '' });
          break;
        case 'session.error':
          this.ev.error(`Agent: ${msg.code ?? ''} ${msg.message ?? e.data}`);
          break;
      }
    };
    ws.onerror = () => this.ev.error('Agent WebSocket error.');
  }

  async stop(): Promise<void> {
    for (const c of this.captures) c.stop();
    for (const s of this.streams) s.getTracks().forEach((t) => t.stop());
    for (const { ws, endMessage } of this.sockets) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(endMessage);
      ws.close();
    }
    this.player?.close();
    this.captures = [];
    this.streams = [];
    this.sockets = [];
    this.player = null;
    this.roomRms = [];
    this.ev.status('Stopped.');
  }
}
