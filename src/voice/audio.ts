/**
 * Browser audio plumbing: mic capture, PCM framing with per-frame loudness, and agent playback.
 *
 * - `openMic`         : getUserMedia with explicit processing constraints (always read back `getSettings()`:
 *                       the browser may ignore them).
 * - `startPcmCapture` : AudioWorklet that frames the mic into fixed-size PCM16 chunks and reports
 *                       the RMS level of each chunk (the raw material for loudness tagging).
 * - `PcmPlayer`       : gapless playback of the agent's PCM16 reply audio, with barge-in flush.
 */

/** Frame length sent to both AssemblyAI products (their docs recommend ~50 ms PCM chunks). */
export const FRAME_MS = 50;

export interface PcmFrame {
  /** Mono 16-bit little-endian PCM for this frame. */
  pcm: Int16Array;
  /** Root-mean-square level of the frame, 0..1 (full scale = 1). */
  rms: number;
}

// Runs on the audio rendering thread. Kept as a string so no bundler config is needed.
const WORKLET_SOURCE = `
class PcmFramer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.frameSamples;
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.size) {
        const pcm = new Int16Array(this.size);
        let sum = 0;
        for (let j = 0; j < this.size; j++) {
          const s = Math.max(-1, Math.min(1, this.buf[j]));
          pcm[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
          sum += s * s;
        }
        this.port.postMessage({ pcm, rms: Math.sqrt(sum / this.size) }, [pcm.buffer]);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-framer', PcmFramer);
`;

/** Requests the microphone with explicit processing flags. Always read back `getSettings()` — the browser may ignore them. */
export function openMic(processing: {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}): Promise<MediaStream> {
  // Browsers expose the microphone API only on secure pages (https or localhost). On a plain-http
  // network address `navigator.mediaDevices` is undefined, which otherwise surfaces as a cryptic TypeError.
  if (!navigator.mediaDevices) {
    throw new Error('Microphone needs a secure page — open http://localhost:5173 on this computer (not the network address).');
  }
  return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, ...processing } });
}

export interface Capture {
  stop: () => void;
}

/**
 * Streams `stream` as PCM16 frames at `sampleRate`. The AudioContext is created at the target
 * rate so the browser resamples for us (16 kHz for Realtime STT, 24 kHz for the Voice Agent API).
 */
export async function startPcmCapture(
  stream: MediaStream,
  sampleRate: number,
  onFrame: (frame: PcmFrame) => void,
): Promise<Capture> {
  const ctx = new AudioContext({ sampleRate });
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);

  const node = new AudioWorkletNode(ctx, 'pcm-framer', {
    processorOptions: { frameSamples: Math.round((sampleRate * FRAME_MS) / 1000) },
  });
  node.port.onmessage = (e: MessageEvent<PcmFrame>) => onFrame(e.data);

  // A silent path to the destination keeps the graph "pulled" so the worklet keeps running.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  ctx.createMediaStreamSource(stream).connect(node).connect(mute).connect(ctx.destination);

  return {
    stop: () => {
      node.port.onmessage = null;
      void ctx.close();
    },
  };
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToPcm16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/** Plays the agent's 24 kHz PCM16 reply chunks back-to-back on the audio clock (no sleeps → no drift). */
export class PcmPlayer {
  private ctx = new AudioContext({ sampleRate: 24000 });
  private playAt = 0;
  private live = new Set<AudioBufferSourceNode>();

  enqueue(pcm: Int16Array): void {
    const buffer = this.ctx.createBuffer(1, pcm.length, 24000);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);
    src.onended = () => this.live.delete(src);
    this.live.add(src);

    this.playAt = Math.max(this.playAt, this.ctx.currentTime);
    src.start(this.playAt);
    this.playAt += buffer.duration;
  }

  /** Barge-in: drop everything queued so the customer never hears stale speech. */
  flush(): void {
    for (const src of this.live) {
      src.onended = null;
      src.stop();
    }
    this.live.clear();
    this.playAt = 0;
  }

  close(): void {
    this.flush();
    void this.ctx.close();
  }
}
