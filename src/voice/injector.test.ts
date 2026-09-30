import { describe, expect, it, vi } from 'vitest';
import { AgentInjector, COACHING_REPLY_INSTRUCTIONS, DEFAULT_MIN_GAP_MS, coachingNote, transferContext } from './injector';
import { OUTCOME_EXPLANATION, OUTCOME_TITLE } from './outcome';
import type { TransferIntent } from './types';

const transfer: TransferIntent = {
  customerId: 'cust-sarah',
  amountGBP: 8000,
  payee: { name: 'Northgate Autos Ltd', sortCode: '99-12-34', accountNumber: '71829035' },
  newPayee: true,
  reference: 'car',
};

const setup = (minGap?: number) => {
  let t = 1_000_000;
  const transport = { systemMessage: vi.fn(), replyNow: vi.fn() };
  const injector = new AgentInjector(transport, () => t, minGap);
  return { transport, injector, advance: (ms: number) => (t += ms) };
};

describe('transferContext', () => {
  it('states amount (formatted) and payee, and whether the payee is new', () => {
    expect(transferContext(transfer)).toBe('The customer is sending £8,000.00 to "Northgate Autos Ltd". They entered this as a new payee.');
    expect(transferContext({ ...transfer, newPayee: false })).toMatch(/an existing payee/);
  });

  it('never includes account details (the agent learns the rest through tools)', () => {
    expect(transferContext(transfer)).not.toMatch(/71829035|99-12-34/);
  });
});

describe('coachingNote', () => {
  it('names the type without underscores and includes the quote when there is one', () => {
    expect(coachingNote('script_feeding', 'tell her it is for a car')).toBe(
      'A second person may be speaking to or coaching the customer (script feeding); they seem to have said: "tell her it is for a car". This is private. Follow your instructions for this situation.',
    );
  });

  it('omits the quote clause when empty', () => {
    expect(coachingNote('secrecy_instruction', '')).not.toMatch(/seem to have said/);
  });
});

describe('AgentInjector', () => {
  it('context() sends a system message, does not make the agent speak, and is never rate-limited', () => {
    const { injector, transport } = setup();
    injector.context('one');
    injector.context('two');
    expect(transport.systemMessage).toHaveBeenCalledTimes(2);
    expect(transport.replyNow).not.toHaveBeenCalled();
  });

  it('coachingDetected() tells the agent, then makes it reply with the gentle-question instructions', () => {
    const { injector, transport } = setup();
    expect(injector.coachingDetected('script_feeding', 'x')).toBe(true);
    expect(transport.systemMessage).toHaveBeenCalledOnce();
    expect(transport.replyNow).toHaveBeenCalledWith(COACHING_REPLY_INSTRUCTIONS);
    // order: context first, then the prompt to speak
    expect(transport.systemMessage.mock.invocationCallOrder[0]).toBeLessThan(transport.replyNow.mock.invocationCallOrder[0]);
  });

  it('allows at most one proactive injection per 20 s', () => {
    const { injector, transport, advance } = setup();
    expect(injector.coachingDetected('a', '')).toBe(true);
    advance(DEFAULT_MIN_GAP_MS - 1);
    expect(injector.coachingDetected('b', '')).toBe(false);
    expect(transport.replyNow).toHaveBeenCalledTimes(1);
    advance(1);
    expect(injector.coachingDetected('c', '')).toBe(true);
    expect(transport.replyNow).toHaveBeenCalledTimes(2);
  });

  it('a suppressed injection sends nothing at all (not even the note)', () => {
    const { injector, transport } = setup();
    injector.coachingDetected('a', '');
    transport.systemMessage.mockClear();
    injector.coachingDetected('b', '');
    expect(transport.systemMessage).not.toHaveBeenCalled();
  });

  it('honours a custom gap', () => {
    const { injector, advance } = setup(1000);
    injector.coachingDetected('a', '');
    advance(1000);
    expect(injector.coachingDetected('b', '')).toBe(true);
  });

  it('the reply instructions are non-accusatory and forbid quoting the note', () => {
    expect(COACHING_REPLY_INSTRUCTIONS).toMatch(/Do not accuse/);
    expect(COACHING_REPLY_INSTRUCTIONS).toMatch(/do not quote the system message/);
    expect(COACHING_REPLY_INSTRUCTIONS).toMatch(/never ask them to lie/);
  });
});

describe('customer-facing outcome wording', () => {
  it('has a title and explanation for every decision', () => {
    for (const d of ['RELEASE', 'COOLING_OFF', 'ESCALATE'] as const) {
      expect(OUTCOME_TITLE[d].length).toBeGreaterThan(5);
      expect(OUTCOME_EXPLANATION[d].length).toBeGreaterThan(20);
    }
  });

  it('never accuses, refuses outright, or reveals scoring', () => {
    for (const text of Object.values(OUTCOME_EXPLANATION)) {
      expect(text).not.toMatch(/\bscam|\brefuse[ds]?\b|\bscore\b|\bpoints?\b|threshold|\brisk\b/i);
    }
    expect(OUTCOME_EXPLANATION.COOLING_OFF).toMatch(/isn't a refusal/);
  });

  it('offers a human on every non-release outcome', () => {
    expect(OUTCOME_EXPLANATION.COOLING_OFF).toMatch(/colleague/);
    expect(OUTCOME_EXPLANATION.ESCALATE).toMatch(/specialist/);
  });
});
