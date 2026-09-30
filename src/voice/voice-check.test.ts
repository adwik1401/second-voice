import { describe, expect, it, vi } from 'vitest';
import type { AgentSessionDeps, AgentSessionEvents } from './agent-client';
import type { DetectInput, DetectResult } from './detect-client';
import type { TranscriptLine, TransferIntent } from './types';
import { VoiceCheck } from './voice-check';

const transfer: TransferIntent = {
  customerId: 'cust-sarah',
  amountGBP: 8000,
  payee: { name: 'Northgate Autos Ltd', sortCode: '99-12-34', accountNumber: '71829035' },
  newPayee: true,
  reference: 'car',
};
const prefetched = {
  profile: { tenureYears: 6, typicalPaymentsGBP: { low: 40, median: 120, high: 400 }, max90dOutgoingGBP: 4200 },
  cop: { result: 'NO_MATCH' as const, accountType: 'personal' as const },
};

const NOTHING: DetectResult = { isCoaching: false, type: 'unclear', quote: '', confidence: 0, source: 'rules' };
const COACH: DetectResult = { isCoaching: true, type: 'secrecy_instruction', quote: "Don't mention me", confidence: 0.9, source: 'rules' };
const flush = () => new Promise((r) => setTimeout(r, 0));
const line = (role: TranscriptLine['role'], text: string, at: number): TranscriptLine => ({ role, text, at });

function setup(over: { detect?: (i: DetectInput) => DetectResult; openMic?: () => Promise<MediaStream>; now?: () => number } = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const session = { start: vi.fn(async () => {}), end: vi.fn(), sendSystemMessage: vi.fn(), requestReply: vi.fn() };
  let events!: AgentSessionEvents;
  let sessionDeps!: Pick<AgentSessionDeps, 'fetchToken' | 'toolHandler'>;
  const detect = vi.fn(async (i: DetectInput) => (over.detect ? over.detect(i) : NOTHING));
  const vc = new VoiceCheck(transfer, prefetched, {
    openMic: over.openMic ?? (async () => stream),
    createSession: (d, e) => {
      sessionDeps = d;
      events = e;
      return session;
    },
    detect,
    now: over.now ?? (() => 1000),
  });
  return { vc, session, track, detect, events: () => events, deps: () => sessionDeps };
}

describe('starting', () => {
  it('opens the mic, starts the session with it, and reports status changes', async () => {
    const { vc, session, events } = setup();
    const seen: string[] = [];
    vc.subscribe(() => seen.push(vc.status));
    await vc.start();
    expect(session.start).toHaveBeenCalledOnce();
    events().status('live');
    expect(vc.status).toBe('live');
    expect(seen).toContain('connecting');
  });

  it('uses the prefetched profile and Confirmation of Payee so the agent need not fetch them again', () => {
    const { vc } = setup();
    expect(vc.state.profile).toEqual(prefetched.profile);
    expect(vc.state.cop).toEqual(prefetched.cop);
  });

  it('sends the transfer as trusted context once the agent is ready (the greeting cannot carry it)', async () => {
    const { vc, session, events } = setup();
    await vc.start();
    events().ready();
    expect(session.sendSystemMessage).toHaveBeenCalledWith('The customer is sending £8,000.00 to "Northgate Autos Ltd". They entered this as a new payee.');
    expect(session.requestReply).not.toHaveBeenCalled(); // context only — the agent does not reply to it
  });
});

describe('fail-safe (spec §9: hold, never release)', () => {
  it('a denied microphone concludes the check with a hold and never creates a session', async () => {
    const { vc, session } = setup({
      openMic: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    });
    await vc.start();
    expect(vc.status).toBe('failed');
    expect(vc.failureReason).toBe('microphone unavailable');
    expect(vc.state.decision).toMatchObject({ decision: expect.stringMatching(/COOLING_OFF|ESCALATE/), offerHuman: true });
    expect(session.start).not.toHaveBeenCalled();
  });

  it('a fatal session error holds the payment and releases the mic', async () => {
    const { vc, track, events } = setup();
    await vc.start();
    events().fatal('connection lost');
    expect(vc.failureReason).toBe('connection lost');
    expect(vc.state.decision?.decision).not.toBe('RELEASE');
    expect(track.stop).toHaveBeenCalled();
  });
});

describe('customer lines', () => {
  it('appends both roles but mines only the customer’s words', async () => {
    const { vc, events } = setup();
    await vc.start();
    events().transcript(line('agent', 'Who told you to do this? Is it urgent?', 1000));
    events().transcript(line('customer', "It's very urgent", 2000));
    await flush();
    expect(vc.transcript).toHaveLength(2);
    expect(vc.state.toRiskSignals().pressureCues).toBe(1); // only the customer's "urgent"
  });

  it('asks the detector about each customer line, with the transfer and the conversation so far', async () => {
    const { vc, events, detect } = setup();
    await vc.start();
    events().transcript(line('customer', "It's for my friend", 2000));
    await flush();
    expect(detect).toHaveBeenCalledOnce();
    expect(detect.mock.calls[0][0]).toMatchObject({
      utterances: [{ source: 'agent_stream', text: "It's for my friend" }],
      transfer: { amountGBP: 8000, payeeName: 'Northgate Autos Ltd' },
    });
  });

  it('never runs the detector on the agent’s own words', async () => {
    const { vc, events, detect } = setup();
    await vc.start();
    events().transcript(line('agent', "Tell her it's for a car deposit", 1000));
    await flush();
    expect(detect).not.toHaveBeenCalled();
  });
});

describe('coaching', () => {
  it('records confident coaching and makes the agent ask ONE gentle question', async () => {
    const { vc, events, session } = setup({ detect: () => COACH });
    await vc.start();
    events().transcript(line('customer', "Tell her it's for a car deposit. Don't mention me.", 2000));
    await flush();
    expect(vc.state.coachingConfidence).toBe(0.9);
    expect(vc.state.snapshot().coachEvidence[0]).toMatchObject({ type: 'secrecy_instruction', source: 'rules' });
    expect(session.requestReply).toHaveBeenCalledOnce();
    expect(session.sendSystemMessage).toHaveBeenCalledWith(expect.stringContaining('secrecy instruction'));
  });

  it('ignores low-confidence detections', async () => {
    const { vc, events, session } = setup({ detect: () => ({ ...COACH, confidence: 0.69 }) });
    await vc.start();
    events().transcript(line('customer', 'maybe', 2000));
    await flush();
    expect(vc.state.coachingConfidence).toBeNull();
    expect(session.requestReply).not.toHaveBeenCalled();
  });

  it('records every piece of evidence but speaks up at most once per 20 s', async () => {
    const { vc, events, session } = setup({ detect: () => COACH });
    await vc.start();
    events().transcript(line('customer', "Don't mention me.", 2000));
    events().transcript(line('customer', "Don't tell the bank why.", 3000));
    await flush();
    expect(vc.state.snapshot().coachEvidence).toHaveLength(2);
    expect(session.requestReply).toHaveBeenCalledTimes(1);
  });
});

describe('echo — the customer repeats what the coach said', () => {
  it('fires when a later customer line repeats an earlier coach line', async () => {
    const { vc, events } = setup({ detect: (i) => (i.utterances[0].text.startsWith('Tell her') ? COACH : NOTHING) });
    await vc.start();
    events().transcript(line('customer', "Tell her it's for a car deposit. Don't mention me.", 10_000)); // the coach, heard as a "customer" line
    await flush();
    events().transcript(line('agent', 'Is anyone with you?', 11_500));
    events().transcript(line('customer', "No, it's for a car deposit.", 14_000)); // ≥ 2 s later
    await flush();
    expect(vc.state.echo).toBe(true);
    expect(vc.state.snapshot().coachEvidence.at(-1)).toMatchObject({ source: 'echo' });
    // coaching + echo = hard trigger
    expect(vc.state.decide()).toMatchObject({ decision: 'ESCALATE' });
  });

  it('does not fire on the same audio transcribed moments later', async () => {
    const { vc, events } = setup({ detect: (i) => (i.utterances[0].text.startsWith('Tell her') ? COACH : NOTHING) });
    await vc.start();
    events().transcript(line('customer', "Tell her it's for a car deposit.", 10_000));
    events().transcript(line('customer', "Tell her it's for a car deposit.", 10_700));
    await flush();
    expect(vc.state.echo).toBe(false);
  });

  it('does not fire without an earlier coach utterance', async () => {
    const { vc, events } = setup();
    await vc.start();
    events().transcript(line('customer', "It's for a car deposit.", 10_000));
    events().transcript(line('customer', "It's for a car deposit.", 14_000));
    await flush();
    expect(vc.state.echo).toBe(false);
  });
});

describe('customer speech windows', () => {
  it('records started→stopped pairs for the Signal Engine', async () => {
    const { vc, events } = setup();
    await vc.start();
    events().speech({ kind: 'started', at: 1000 });
    events().speech({ kind: 'stopped', at: 2500 });
    events().speech({ kind: 'stopped', at: 9999 }); // a stray stop is ignored
    events().speech({ kind: 'started', at: 4000 });
    expect(vc.customerWindows).toEqual([{ start: 1000, end: 2500 }]);
  });
});

describe('decisions reach the UI', () => {
  it('decide_payment (run by the agent’s tool) concludes the check and notifies subscribers', async () => {
    const { vc, deps } = setup();
    await vc.start();
    const changed = vi.fn();
    vc.subscribe(changed);
    const out = await deps().toolHandler('decide_payment', {});
    expect(out.isError).toBe(false);
    expect(vc.state.decision).not.toBeNull();
    expect(changed).toHaveBeenCalled();
  });
});

describe('ending', () => {
  it('ends the session, releases the mic, and is safe to repeat', async () => {
    const { vc, session, track } = setup();
    await vc.start();
    vc.end();
    vc.end();
    expect(session.end).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce(); // second call finds no stream
    expect(vc.status).toBe('ended');
  });

  it('keeps a failed status rather than overwriting it with "ended"', async () => {
    const { vc, events } = setup();
    await vc.start();
    events().fatal('connection lost');
    vc.end();
    expect(vc.status).toBe('failed');
  });
});
