/**
 * Mock bank services (Plan Step 10): the three lookups behind the agent's tools.
 * Pure functions over the fictional data in bank-data.ts so they are trivially testable.
 */
import { tokenize, wordsMatch } from '../../src/core/text-match';
import type { CopResult } from '../../src/core/types';
import { CUSTOMERS, PAYEE_ACCOUNTS, type CustomerProfile, type PayeeAccount } from './bank-data';

/** Sort codes and account numbers arrive in many spoken/typed shapes ("99-12-34", "991234"); keep digits only. */
const digits = (s: string) => s.replace(/\D/g, '');

const findAccount = (sortCode: string, accountNumber: string): PayeeAccount | undefined =>
  PAYEE_ACCOUNTS.find((a) => digits(a.sortCode) === digits(sortCode) && digits(a.accountNumber) === digits(accountNumber));

export function getCustomerProfile(customerId: string): CustomerProfile | null {
  return CUSTOMERS.find((c) => c.customerId === customerId) ?? null;
}

// ---- Confirmation of Payee -------------------------------------------------------------------------

export interface PayeeCheck {
  result: CopResult;
  accountType: 'personal' | 'business' | null;
  /** Revealed only on CLOSE_MATCH, as the real scheme does; never on NO_MATCH (it would leak the holder's name). */
  suggestedName?: string;
}

/** Legal suffixes carry no identity ("Acme" and "Acme Ltd" are the same payee). */
const LEGAL_SUFFIXES = new Set(['ltd', 'limited', 'plc', 'llp']);
const nameTokens = (name: string) => tokenize(name).filter((t) => !LEGAL_SUFFIXES.has(t));

function compareNames(typed: string, actual: string): Exclude<CopResult, 'UNAVAILABLE'> {
  const a = nameTokens(typed);
  const b = nameTokens(actual);
  if (a.length === 0 || b.length === 0) return 'NO_MATCH';
  if (a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ')) return 'MATCH';
  // Otherwise a fuzzy, partial overlap is a near miss worth flagging; nothing in common is a mismatch.
  const matched = a.filter((t) => b.some((u) => wordsMatch(t, u))).length;
  return matched >= Math.ceil(Math.max(a.length, b.length) / 2) ? 'CLOSE_MATCH' : 'NO_MATCH';
}

/** Does the name the customer typed match the account holder? UNAVAILABLE when the account is unknown. */
export function checkPayee(input: { sortCode: string; accountNumber: string; name: string }): PayeeCheck {
  const account = findAccount(input.sortCode, input.accountNumber);
  if (!account) return { result: 'UNAVAILABLE', accountType: null };
  const result = compareNames(input.name, account.holderName);
  return {
    result,
    accountType: account.accountType,
    ...(result === 'CLOSE_MATCH' ? { suggestedName: account.holderName } : {}),
  };
}

// ---- Payee risk ------------------------------------------------------------------------------------

export interface PayeeRisk {
  accountAgeDays: number;
  muleRiskScore: number;
  priorReports: number;
}

/** null when the account is unknown — the caller surfaces that as a failed tool (an unverified payee). */
export function getPayeeRisk(sortCode: string, accountNumber: string): PayeeRisk | null {
  const account = findAccount(sortCode, accountNumber);
  return account
    ? { accountAgeDays: account.accountAgeDays, muleRiskScore: account.muleRisk, priorReports: account.priorReports }
    : null;
}
