import { describe, expect, it, vi } from 'vitest';
import { CheckState } from './check-state';
import { createToolRunner } from './tools';
import type { TransferIntent } from './types';

const transfer: TransferIntent = {
  customerId: 'cust-sarah',
  amountGBP: 8000,
  payee: { name: 'Northgate Autos Ltd', sortCode: '99-12-34', accountNumber: '71829035' },
  newPayee: true,
  reference: 'car',
};

/** A fetch stub routing on the path; `null` means "respond 404". */
function bankFetch(routes: Record<string, unknown | null>) {
  return vi.fn(async (input: string | URL | Request) => {
    const path = String(input).split('?')[0];
    const body = routes[path];
    if (body === undefined || body === null) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const PROFILE = { tenureYears: 6, typicalPaymentsGBP: { low: 40, median: 120, high: 400 }, max90dOutgoingGBP: 4200 };
const COP = { result: 'NO_MATCH', accountType: 'personal' };
const RISK = { accountAgeDays: 9, muleRiskScore: 0.62, priorReports: 1 };
const setup = (routes: Record<string, unknown | null> = {}, deps = {}) => {
  const state = new CheckState(transfer);
  const fetchImpl = bankFetch({ '/api/bank/profile': PROFILE, '/api/bank/payee-check': COP, '/api/bank/payee-risk': RISK, ...routes });
  return { state, fetchImpl, run: createToolRunner(state, { fetchImpl, now: () => 5000, ...deps }) };
};

describe('get_customer_profile', () => {
  it('fetches the profile, stores it, and returns a trimmed view', async () => {
    const { run, state } = setup();
    const out = await run('get_customer_profile');
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({ tenureYears: 6, typicalPaymentsGBP: PROFILE.typicalPaymentsGBP, largestPaymentLast90DaysGBP: 4200 });
    expect(state.profile).toEqual(PROFILE);
  });

  it('on failure reports "could not be verified" and marks a tool failure', async () => {
    const { run, state } = setup({ '/api/bank/profile': null });
    expect(await run('get_customer_profile')).toMatchObject({ isError: true });
    expect(state.toolFailed).toBe(true);
  });
});

describe('check_payee', () => {
  it('fetches Confirmation of Payee when the form has not already run it', async () => {
    const { run, state, fetchImpl } = setup();
    const out = await run('check_payee');
    expect(out).toEqual({ result: COP, isError: false });
    expect(state.cop).toEqual(COP);
    const url = String(((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0]);
    expect(url).toContain('name=Northgate+Autos+Ltd');
    expect(url).toContain('sortCode=99-12-34');
  });

  it('reuses the result the transfer form already obtained (no second call)', async () => {
    const { run, state, fetchImpl } = setup();
    state.setCop({ result: 'CLOSE_MATCH', accountType: 'business', suggestedName: 'Global Invest Partners Ltd' });
    const out = await run('check_payee');
    expect(out.result).toMatchObject({ result: 'CLOSE_MATCH' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('an UNAVAILABLE result is returned normally but counts as unverified', async () => {
    const { run, state } = setup({ '/api/bank/payee-check': { result: 'UNAVAILABLE', accountType: null } });
    const out = await run('check_payee');
    expect(out.isError).toBe(false);
    expect(state.toolFailed).toBe(true);
  });

  it('a failed call is an error and marks a tool failure', async () => {
    const { run, state } = setup({ '/api/bank/payee-check': null });
    expect((await run('check_payee')).isError).toBe(true);
    expect(state.toolFailed).toBe(true);
  });
});

describe('get_payee_risk', () => {
  it('fetches and stores the risk record', async () => {
    const { run, state } = setup();
    expect(await run('get_payee_risk')).toEqual({ result: RISK, isError: false });
    expect(state.payeeRisk).toEqual(RISK);
  });

  it('an unknown account (404) is an error and a tool failure', async () => {
    const { run, state } = setup({ '/api/bank/payee-risk': null });
    expect((await run('get_payee_risk')).isError).toBe(true);
    expect(state.toolFailed).toBe(true);
  });
});

describe('record_answer', () => {
  it('records the answer with the injected clock', async () => {
    const { run, state } = setup();
    expect(await run('record_answer', { topic: 'purpose', answer: '  a car deposit  ' })).toEqual({ result: { recorded: true }, isError: false });
    expect(state.answers).toEqual([{ topic: 'purpose', answer: 'a car deposit', at: 5000 }]);
  });

  it.each([
    ['an unknown topic', { topic: 'feelings', answer: 'x' }],
    ['no answer', { topic: 'purpose' }],
    ['a blank answer', { topic: 'purpose', answer: '   ' }],
    ['a non-string answer', { topic: 'purpose', answer: 5 }],
  ])('rejects %s', async (_name, args) => {
    const { run, state } = setup();
    expect((await run('record_answer', args)).isError).toBe(true);
    expect(state.answers).toHaveLength(0);
  });

  it('limits a very long answer to 500 characters', async () => {
    const { run, state } = setup();
    await run('record_answer', { topic: 'purpose', answer: 'x'.repeat(900) });
    expect(state.answers[0].answer).toHaveLength(500);
  });
});

describe('decide_payment', () => {
  it('returns ONLY the decision, the kind explanation and whether to offer a human — never score or reasons', async () => {
    const { run } = setup();
    await run('get_payee_risk');
    await run('check_payee');
    const out = await run('decide_payment');
    expect(out.isError).toBe(false);
    expect(Object.keys(out.result as object).sort()).toEqual(['decision', 'explanation', 'offerHuman']);
    expect(JSON.stringify(out.result)).not.toMatch(/score|points|reasons|threshold/i);
  });

  it('decides on everything gathered so far and notifies the listener', async () => {
    const onDecision = vi.fn();
    const { run, state } = setup({}, { onDecision });
    await run('get_payee_risk');
    await run('check_payee');
    state.recordAnswer('purpose', 'a car from a dealer', 1);
    state.noteCoaching({ at: 2, source: 'rules', type: 'secrecy_instruction', quote: 'x', confidence: 0.9 });
    const out = await run('decide_payment');
    expect((out.result as { decision: string }).decision).toBe('ESCALATE');
    expect(onDecision).toHaveBeenCalledOnce();
    expect(state.decision?.decision).toBe('ESCALATE');
  });
});

describe('request_human', () => {
  it('records the reason and notifies the listener', async () => {
    const onHumanRequested = vi.fn();
    const { run, state } = setup({}, { onHumanRequested });
    const out = await run('request_human', { reason: 'customer asked for a person' });
    expect(out.isError).toBe(false);
    expect(state.humanRequested).toBe('customer asked for a person');
    expect(onHumanRequested).toHaveBeenCalledWith('customer asked for a person');
  });

  it('defaults the reason when none is given', async () => {
    const { run, state } = setup();
    await run('request_human', {});
    expect(state.humanRequested).toBe('customer asked for a person');
  });
});

describe('unknown tools', () => {
  it('are errors, not crashes', async () => {
    const { run } = setup();
    expect(await run('transfer_all_the_money')).toMatchObject({ isError: true });
  });
});
