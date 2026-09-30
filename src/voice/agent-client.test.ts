import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSession, type AgentSessionEvents, type SocketLike } from './agent-client';

/** A scriptable WebSocket double. */
class FakeSocket implements SocketLike {
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.onopen?.();
  }
  emit(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  types() {
    return this.sent.map((m) => m.type);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(over: { toolHandler?: (n: string, a: Record<string, unknown>) => Promise<{ result: unknown; isError: boolean }>; tokenFails?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const player = { enqueue: vi.fn(), flush: vi.fn(), close: vi.fn() };
  const capture = { stop: vi.fn() };
  let onFrame: (f: { pcm: Int16Array }) => void = () => {};
  const startCapture = vi.fn(async (_s: MediaStream, _rate: number, cb: (f: { pcm: Int16Array }) => void) => {
    onFrame = cb;
    return capture;
  });
  let tokenN = 0;
  const fetchToken = vi.fn(async () => {
    if (over.tokenFails) throw new Error('no token');
    return { token: `tok${++tokenN}`, agentId: 'agent_test' };
  });
  const events = {
    status: vi.fn(),
    transcript: vi.fn(),
    speech: vi.fn(),
    ready: vi.fn(),
    fatal: vi.fn(),
  } satisfies AgentSessionEvents;
  const toolHandler = vi.fn(over.toolHandler ?? (async () => ({ result: { ok: true }, isError: false })));
  let t = 1000;
  const session = new AgentSession(
    {
      fetchToken,
      toolHandler,
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      createPlayer: () => player,
      startCapture,
      now: () => (t += 10),
      connectTimeoutMs: 5000,
    },
    events,
  );
  const stream = {} as MediaStream;
  /** Starts and brings the session live. */
  const goLive = async () => {
    await session.start(stream);
    sockets[0].open();
    sockets[0].emit({ type: 'session.ready', session_id: 'sess_1' });
    await tick();
    return sockets[0];
  };
  return { session, sockets, player, capture, startCapture, fetchToken, events, toolHandler, stream, goLive, frame: (pcm: Int16Array) => onFrame({ pcm }) };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe('starting', () => {
  it('fetches a token, connects with it, and binds the stored agent on open', async () => {
    const { session, sockets, events, fetchToken } = setup();
    await session.start({} as MediaStream);
    expect(fetchToken).toHaveBeenCalledOnce();
    expect(sockets[0].url).toBe('wss://agents.assemblyai.com/v1/ws?token=tok1');
    sockets[0].open();
    expect(sockets[0].sent).toEqual([{ type: 'session.update', session: { agent_id: 'agent_test' } }]);
    expect(events.status).toHaveBeenCalledWith('connecting');
  });

  it('goes live on session.ready, starts the mic exactly once and announces ready exactly once', async () => {
    const { goLive, events, startCapture, sockets } = setup();
    await goLive();
    sockets[0].emit({ type: 'session.ready', session_id: 'sess_1' }); // a second ready
    await tick();
    expect(events.status).toHaveBeenLastCalledWith('live');
    expect(startCapture).toHaveBeenCalledOnce();
    expect(startCapture.mock.calls[0][1]).toBe(24_000);
    expect(events.ready).toHaveBeenCalledOnce();
  });

  it('fails cleanly when no token can be obtained', async () => {
    const { session, events } = setup({ tokenFails: true });
    await session.start({} as MediaStream);
    expect(events.fatal).toHaveBeenCalledWith('could not get a session token');
    expect(events.status).toHaveBeenLastCalledWith('failed');
  });

  it('fails if the agent never becomes ready in time', async () => {
    vi.useFakeTimers();
    const { session, events } = setup();
    await session.start({} as MediaStream);
    vi.advanceTimersByTime(5001);
    expect(events.fatal).toHaveBeenCalledWith('timed out connecting to the voice agent');
  });
});

describe('audio', () => {
  it('sends mic frames as base64 input.audio while the socket is open, and drops them otherwise', async () => {
    const { goLive, frame } = setup();
    const ws = await goLive();
    frame(new Int16Array([1, 2, 3, 4]));
    expect(ws.sent.at(-1)).toMatchObject({ type: 'input.audio' });
    expect(typeof ws.sent.at(-1)!.audio).toBe('string');

    const before = ws.sent.length;
    ws.readyState = 3;
    frame(new Int16Array([1, 2]));
    expect(ws.sent.length).toBe(before);
  });

  it('plays reply audio and flushes playback on a barge-in (interrupted reply) only', async () => {
    const { goLive, player } = setup();
    const ws = await goLive();
    ws.emit({ type: 'reply.audio', data: btoa(String.fromCharCode(1, 0, 2, 0)) });
    expect(player.enqueue).toHaveBeenCalledOnce();
    ws.emit({ type: 'reply.done', status: 'completed' });
    expect(player.flush).not.toHaveBeenCalled();
    ws.emit({ type: 'reply.done', status: 'interrupted' });
    expect(player.flush).toHaveBeenCalledOnce();
  });
});

describe('events to the app', () => {
  it('emits transcripts with roles and timestamps, and customer speech boundaries', async () => {
    const { goLive, events } = setup();
    const ws = await goLive();
    ws.emit({ type: 'input.speech.started' });
    ws.emit({ type: 'input.speech.stopped' });
    ws.emit({ type: 'transcript.user', text: 'It is for a car' });
    ws.emit({ type: 'transcript.agent', text: 'I see.' });
    expect(events.speech.mock.calls.map((c) => c[0].kind)).toEqual(['started', 'stopped']);
    expect(events.transcript.mock.calls.map((c) => [c[0].role, c[0].text])).toEqual([
      ['customer', 'It is for a car'],
      ['agent', 'I see.'],
    ]);
    const [a, b] = events.transcript.mock.calls.map((c) => c[0].at);
    expect(b).toBeGreaterThan(a);
  });
});

describe('tool results — sent only when reply.done is the latest event', () => {
  const call = { type: 'tool.call', call_id: 'c1', name: 'check_payee', arguments: {} };
  const results = (ws: FakeSocket) => ws.sent.filter((m) => m.type === 'tool.result');

  it('waits for reply.done when the tool finishes first', async () => {
    const { goLive, toolHandler } = setup();
    const ws = await goLive();
    ws.emit(call);
    await tick();
    expect(toolHandler).toHaveBeenCalledWith('check_payee', {});
    expect(results(ws)).toHaveLength(0); // the agent is still mid-phrase
    ws.emit({ type: 'reply.audio', data: '' });
    expect(results(ws)).toHaveLength(0);
    ws.emit({ type: 'reply.done', status: 'completed' });
    expect(results(ws)).toEqual([{ type: 'tool.result', call_id: 'c1', result: '{"ok":true}' }]);
  });

  it('sends immediately when reply.done arrived first and the tool finishes later', async () => {
    let finish: (v: { result: unknown; isError: boolean }) => void = () => {};
    const { goLive } = setup({ toolHandler: () => new Promise((r) => (finish = r)) });
    const ws = await goLive();
    ws.emit(call);
    ws.emit({ type: 'reply.done', status: 'completed' });
    expect(results(ws)).toHaveLength(0);
    finish({ result: { late: true }, isError: false });
    await tick();
    expect(results(ws)).toEqual([{ type: 'tool.result', call_id: 'c1', result: '{"late":true}' }]);
  });

  it('flags failures with is_error', async () => {
    const { goLive } = setup({ toolHandler: async () => ({ result: { error: 'nope' }, isError: true }) });
    const ws = await goLive();
    ws.emit(call);
    await tick();
    ws.emit({ type: 'reply.done', status: 'completed' });
    expect(results(ws)[0]).toMatchObject({ call_id: 'c1', is_error: true });
  });

  it('turns a throwing handler into a generic error result (never a crash, never a leak)', async () => {
    const { goLive } = setup({
      toolHandler: async () => {
        throw new Error('database password is hunter2');
      },
    });
    const ws = await goLive();
    ws.emit(call);
    await tick();
    ws.emit({ type: 'reply.done', status: 'completed' });
    const r = results(ws)[0];
    expect(r.is_error).toBe(true);
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });

  it('flushes several tool calls from one turn together', async () => {
    const { goLive } = setup();
    const ws = await goLive();
    ws.emit({ ...call, call_id: 'a', name: 'check_payee' });
    ws.emit({ ...call, call_id: 'b', name: 'get_payee_risk' });
    await tick();
    ws.emit({ type: 'reply.done', status: 'completed' });
    expect(results(ws).map((r) => r.call_id)).toEqual(['a', 'b']);
  });

  it('does not resend a result that was already delivered', async () => {
    const { goLive } = setup();
    const ws = await goLive();
    ws.emit(call);
    await tick();
    ws.emit({ type: 'reply.done', status: 'completed' });
    ws.emit({ type: 'reply.done', status: 'completed' });
    expect(results(ws)).toHaveLength(1);
  });
});

describe('messages to the agent', () => {
  it('sends trusted context as a system-role conversation.message, and reply requests with instructions', async () => {
    const { goLive, session } = setup();
    const ws = await goLive();
    session.sendSystemMessage('The customer is sending £8,000.');
    session.requestReply('Ask one gentle question.');
    expect(ws.sent.slice(-2)).toEqual([
      { type: 'conversation.message', role: 'system', content: 'The customer is sending £8,000.' },
      { type: 'reply.create', instructions: 'Ask one gentle question.' },
    ]);
  });
});

describe('ending', () => {
  it('sends session.end BEFORE closing, stops the mic and playback, and reports ended', async () => {
    const { goLive, session, capture, player, events } = setup();
    const ws = await goLive();
    session.end();
    expect(ws.types().at(-1)).toBe('session.end');
    expect(ws.closed).toBe(true);
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(player.close).toHaveBeenCalledOnce();
    expect(events.status).toHaveBeenLastCalledWith('ended');
    expect(events.fatal).not.toHaveBeenCalled();
  });

  it('is idempotent, and ignores anything the server says afterwards', async () => {
    const { goLive, session, events } = setup();
    const ws = await goLive();
    session.end();
    session.end();
    ws.onmessage?.({ data: JSON.stringify({ type: 'transcript.user', text: 'late' }) });
    expect(events.transcript).not.toHaveBeenCalled();
  });
});

describe('reconnecting (spec §9)', () => {
  it('resumes the session once with a fresh token after an unexpected drop', async () => {
    const { goLive, sockets, events, fetchToken } = setup();
    const first = await goLive();
    first.drop();
    expect(events.status).toHaveBeenCalledWith('reconnecting');
    await tick();
    expect(fetchToken).toHaveBeenCalledTimes(2); // tokens are single-use
    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toContain('token=tok2');
    sockets[1].open();
    expect(sockets[1].sent).toEqual([{ type: 'session.resume', session_id: 'sess_1' }]);
    sockets[1].emit({ type: 'session.ready', session_id: 'sess_1' });
    await tick();
    expect(events.status).toHaveBeenLastCalledWith('live');
    expect(events.ready).toHaveBeenCalledOnce(); // not announced again
    expect(events.fatal).not.toHaveBeenCalled();
  });

  it('keeps the same mic capture across a reconnect', async () => {
    const { goLive, sockets, startCapture } = setup();
    const first = await goLive();
    first.drop();
    await tick();
    sockets[1].open();
    sockets[1].emit({ type: 'session.ready', session_id: 'sess_1' });
    await tick();
    expect(startCapture).toHaveBeenCalledOnce();
  });

  it('gives up after the second drop: fatal "connection lost"', async () => {
    const { goLive, sockets, events } = setup();
    const first = await goLive();
    first.drop();
    await tick();
    sockets[1].open();
    sockets[1].emit({ type: 'session.ready', session_id: 'sess_1' });
    await tick();
    sockets[1].drop();
    expect(events.fatal).toHaveBeenCalledWith('connection lost');
    expect(events.status).toHaveBeenLastCalledWith('failed');
  });

  it('is fatal when the session has expired (session_not_found)', async () => {
    const { goLive, sockets, events } = setup();
    const first = await goLive();
    first.drop();
    await tick();
    sockets[1].open();
    sockets[1].emit({ type: 'session.error', code: 'session_not_found' });
    expect(events.fatal).toHaveBeenCalledWith('could not resume the voice session');
  });

  it('does not treat a deliberate end as a drop', async () => {
    const { goLive, session, sockets, events } = setup();
    const ws = await goLive();
    session.end();
    ws.onclose?.();
    await tick();
    expect(sockets).toHaveLength(1);
    expect(events.fatal).not.toHaveBeenCalled();
  });
});
