import { describe, expect, it, vi } from 'vitest';
import { checkPayee as mockCheckPayee, getCustomerProfile } from '../../api/_lib/bank';
import { SCENARIOS } from './scenarios';
import { EMPTY_FORM, evaluateTransfer, isKnownPayee, validateForm, type TransferForm } from './transfer';

/** A fetch that serves the REAL mock-bank logic, so scenarios are tested against the actual demo data. */
const bankFetch = vi.fn(async (input: string | URL | Request) => {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname === '/api/bank/profile') {
    const p = getCustomerProfile(url.searchParams.get('customerId') ?? '');
    return p ? Response.json(p) : new Response('{}', { status: 404 });
  }
  if (url.pathname === '/api/bank/payee-check') {
    return Response.json(mockCheckPayee({ sortCode: url.searchParams.get('sortCode')!, accountNumber: url.searchParams.get('accountNumber')!, name: url.searchParams.get('name')! }));
  }
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

const valid: TransferForm = { payeeName: 'Priya Shah', sortCode: '20-45-11', accountNumber: '40112233', amount: '400', reference: 'x' };

describe('validateForm', () => {
  it('accepts a valid form', () => {
    expect(validateForm(valid)).toBeNull();
  });

  it.each([
    ['a missing name', { payeeName: '  ' }, /name/],
    ['a short sort code', { sortCode: '20-45' }, /sort code/],
    ['a short account number', { accountNumber: '1234' }, /account number/],
    ['a zero amount', { amount: '0' }, /greater than zero/],
    ['a negative amount', { amount: '-5' }, /greater than zero/],
    ['a non-numeric amount', { amount: 'lots' }, /greater than zero/],
    ['an absurd amount', { amount: '5000000' }, /limit/],
  ])('rejects %s', (_name, over, message) => {
    expect(validateForm({ ...valid, ...over })).toMatch(message);
  });

  it('accepts sort codes and account numbers in any formatting', () => {
    expect(validateForm({ ...valid, sortCode: '204511', accountNumber: '4011 2233' })).toBeNull();
  });
});

describe('isKnownPayee', () => {
  const known = [{ name: 'Priya Shah', sortCode: '20-45-11', accountNumber: '40112233' }];
  it('matches on sort code and account number regardless of formatting or the typed name', () => {
    expect(isKnownPayee(known, { name: 'P Shah', sortCode: '204511', accountNumber: '4011 2233' })).toBe(true);
  });
  it('does not match a different account', () => {
    expect(isKnownPayee(known, { name: 'Priya Shah', sortCode: '20-45-11', accountNumber: '99999999' })).toBe(false);
  });
});

describe('evaluateTransfer — the four demo scenarios against the real mock bank', () => {
  const run = (id: string) => evaluateTransfer(SCENARIOS.find((s) => s.id === id)!.form, bankFetch);

  it('S1: £400 to a known payee is sent with no check', async () => {
    expect(await run('S1')).toMatchObject({ kind: 'sent', transfer: { amountGBP: 400, newPayee: false } });
  });

  it('S2: £1,200 to a new but legitimate payee gets a voice check (new payee)', async () => {
    const out = await run('S2');
    expect(out).toMatchObject({ kind: 'check', cop: { result: 'MATCH' }, transfer: { newPayee: true } });
    expect(out.kind === 'check' && out.reasons).toEqual(['new payee']);
  });

  it('S3: the investment scam gets a voice check (close-match name, new payee)', async () => {
    const out = await run('S3');
    expect(out).toMatchObject({ kind: 'check', cop: { result: 'CLOSE_MATCH' } });
  });

  it('S4: £8,000 to the "car dealer" gets a voice check with both reasons', async () => {
    const out = await run('S4');
    expect(out).toMatchObject({ kind: 'check', cop: { result: 'NO_MATCH', accountType: 'personal' } });
    expect(out.kind === 'check' && out.reasons).toHaveLength(2);
  });

  it('carries the profile so the check need not fetch it again', async () => {
    const out = await run('S4');
    expect(out.kind === 'check' && out.profile.max90dOutgoingGBP).toBe(4200);
  });
});

describe('evaluateTransfer — failure handling', () => {
  it('returns the validation error without touching the network', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await evaluateTransfer(EMPTY_FORM, f)).toMatchObject({ kind: 'invalid' });
    expect(f).not.toHaveBeenCalled();
  });

  it('does NOT send the payment when the bank cannot be reached', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await evaluateTransfer(valid, down)).toMatchObject({ kind: 'error' });
  });

  it('treats a Confirmation of Payee failure as unverified — a £1,000+ payment still gets the voice check', async () => {
    const copDown = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith('/api/bank/payee-check')) throw new TypeError('offline');
      return bankFetch(input);
    }) as unknown as typeof fetch;
    const out = await evaluateTransfer(SCENARIOS.find((s) => s.id === 'S2')!.form, copDown);
    expect(out).toMatchObject({ kind: 'check', cop: { result: 'UNAVAILABLE' } });
  });
});
