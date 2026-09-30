import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocketLike } from './agent-client';
import { RoomListener } from './room-listener';

class FakeSocket implements SocketLike {
  readyState = 1;
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  emit(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  text() {
    return this.sent.filter((s): s is string => typeof s === 'string').map((s) => JSON.parse(s));
  }
  binary() {
    return this.sent.filter((s) => typeof s !== 'string');
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(over: { tokenFails?: boolean } = {}) {
  let socket!: FakeSocket;
  const capture = { stop: vi.fn() };
  let onFrame: (f: { pcm: Int16Array; rms: number }) => void = () => {};
  const startCapture = vi.fn(async (_s: MediaStream, _r: number, cb: typeof onFrame) => {
    onFrame = cb;
    return capture;
  });
  const events = { status: vi.fn(), turn: vi.fn() };
  let t = 5000;
  const listener = new RoomListener(
    {
      fetchToken: async () => {
        if (over.tokenFails) throw new Error('no token');
        return 'stt-token';
      },
      createSocket: (url) => (socket = new FakeSocket(url)),
      startCapture,
      now: () => (t += 100),
      connectTimeoutMs: 4000,
    },
    events,
  );
  const goLive = async () => {
    await listener.start({} as MediaStream);
    socket.emit({ type: 'Begin', id: 'x' });
    await tick();
  };
  const sendFrames = (rmsValues: number[]) => rmsValues.forEach((rms) => onFrame({ pcm: new Int16Array(800), rms }));
  return { listener, events, goLive, sendFrames, startCapture, capture, socket: () => socket };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe('connecting', () => {
  it('connects with the token, 16 kHz and speaker labels, and reports connecting', async () => {
    const { listener, events, socket } = setup();
    await listener.start({} as MediaStream);
    const url = new URL(socket().url);
    expect(url.origin + url.pathname).toBe('wss://streaming.assemblyai.com/v3/ws');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ token: 'stt-token', sample_rate: '16000', speaker_labels: 'true', max_speakers: '3' });
    expect(events.status).toHaveBeenCalledWith('connecting');
  });

  it('starts the mic only after Begin, then reports live', async () => {
    const { listener, events, startCapture, socket } = setup();
    await listener.start({} as MediaStream);
    expect(startCapture).not.toHaveBeenCalled();
    socket().emit({ type: 'Begin' });
    await tick();
    expect(startCapture).toHaveBeenCalledOnce();
    expect(startCapture.mock.calls[0][1]).toBe(16_000);
    expect(events.status).toHaveBeenLastCalledWith('live');
  });

  it('sends each mic frame as a BINARY frame (no JSON, no base64)', async () => {
    const { goLive, sendFrames, socket } = setup();
    await goLive();
    sendFrames([0.01, 0.02]);
    expect(socket().binary()).toHaveLength(2);
    expect(socket().binary()[0]).toBeInstanceOf(ArrayBuffer);
  });
});

describe('turns', () => {
  it('ignores partial turns and emits finalised ones', async () => {
    const { goLive, events, socket } = setup();
    await goLive();
    socket().emit({ type: 'Turn', end_of_turn: false, transcript: 'hel', words: [] });
    expect(events.turn).not.toHaveBeenCalled();
    socket().emit({ type: 'Turn', end_of_turn: true, speaker_label: 'B', transcript: 'hello', words: [{ text: 'hello', start: 0, end: 200 }] });
    expect(events.turn).toHaveBeenCalledOnce();
    expect(events.turn.mock.calls[0][0]).toMatchObject({ speaker: 'B', words: [{ text: 'hello', speaker: 'B' }] });
  });

  it('tags each word with its loudness from the frames actually sent', async () => {
    const { goLive, sendFrames, events, socket } = setup();
    await goLive();
    sendFrames([0.1, 0.1, 0.1, 0.1, 0.001, 0.001, 0.001, 0.001]); // 200 ms loud then 200 ms quiet
    socket().emit({
      type: 'Turn',
      end_of_turn: true,
      speaker_label: 'A',
      transcript: 'loud quiet',
      words: [
        { text: 'loud', start: 0, end: 200 },
        { text: 'quiet', start: 200, end: 400 },
      ],
    });
    const [loud, quiet] = events.turn.mock.calls[0][0].words;
    expect(loud.dbfs).toBeCloseTo(-20, 0);
    expect(quiet.dbfs).toBeCloseTo(-60, 0);
  });

  it('keeps the text of a turn that arrives with no per-word data, without loudness', async () => {
    const { goLive, events, socket } = setup();
    await goLive();
    socket().emit({ type: 'Turn', end_of_turn: true, speaker_label: 'PENDING', transcript: "Tell her it's for a car", words: [] });
    const words = events.turn.mock.calls[0][0].words;
    expect(words.map((w: { text: string }) => w.text)).toEqual(['Tell', 'her', "it's", 'for', 'a', 'car']);
    expect(words[0]).toMatchObject({ dbfs: null, speaker: 'PENDING' });
  });

  it('drops an empty turn', async () => {
    const { goLive, events, socket } = setup();
    await goLive();
    socket().emit({ type: 'Turn', end_of_turn: true, transcript: '', words: [] });
    expect(events.turn).not.toHaveBeenCalled();
  });

  it('passes a wall-clock start time so word offsets can be placed on the conversation timeline', async () => {
    const { goLive, sendFrames, events, socket } = setup();
    await goLive();
    sendFrames([0.01]);
    socket().emit({ type: 'Turn', end_of_turn: true, speaker_label: 'A', transcript: 'hi', words: [{ text: 'hi', start: 0, end: 100 }] });
    expect(events.turn.mock.calls[0][1]).toBeGreaterThan(5000);
  });
});

describe('failing soft — the check continues on the agent stream', () => {
  it('reports unavailable when no token can be obtained', async () => {
    const { listener, events } = setup({ tokenFails: true });
    await listener.start({} as MediaStream);
    expect(events.status).toHaveBeenLastCalledWith('unavailable');
  });

  it('reports unavailable on an error message from the server', async () => {
    const { goLive, events, socket, capture } = setup();
    await goLive();
    socket().emit({ type: 'Error', error: 'nope' });
    expect(events.status).toHaveBeenLastCalledWith('unavailable');
    expect(capture.stop).toHaveBeenCalled();
  });

  it('reports unavailable when the socket drops unexpectedly', async () => {
    const { goLive, events, socket } = setup();
    await goLive();
    socket().drop();
    expect(events.status).toHaveBeenLastCalledWith('unavailable');
  });

  it('reports unavailable if Begin never arrives in time', async () => {
    vi.useFakeTimers();
    const { listener, events } = setup();
    await listener.start({} as MediaStream);
    vi.advanceTimersByTime(4001);
    expect(events.status).toHaveBeenLastCalledWith('unavailable');
  });
});

describe('ending', () => {
  it('sends Terminate before closing, stops the mic, and does not report a failure', async () => {
    const { listener, goLive, events, socket, capture } = setup();
    await goLive();
    listener.end();
    expect(socket().text().at(-1)).toEqual({ type: 'Terminate' });
    expect(socket().closed).toBe(true);
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(events.status).not.toHaveBeenCalledWith('unavailable');
  });

  it('is idempotent and ignores a late close', async () => {
    const { listener, goLive, events, socket } = setup();
    await goLive();
    const ws = socket();
    listener.end();
    listener.end();
    ws.onclose?.();
    expect(events.status).not.toHaveBeenCalledWith('unavailable');
  });
});
