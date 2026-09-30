/**
 * The transfer flow behind the Larkmoor form (Plan Step 13): validate → is the payee known? → Confirmation of
 * Payee → precheck. Kept out of the React component so the rules are tested in one place.
 * Fail-safe: if the bank cannot be reached the payment is NOT sent; if only Confirmation of Payee fails it
 * counts as unverified (`UNAVAILABLE`), which triggers the voice check for any payment of £1,000 or more.
 */
import { precheck } from '../core/precheck';
import type { CopInfo, PayeeRef, ProfileInfo, TransferIntent } from '../voice/types';
import { checkPayee, fetchProfile } from './bank-api';

export const CUSTOMER_ID = 'cust-sarah';

export interface TransferForm {
  payeeName: string;
  sortCode: string;
  accountNumber: string;
  amount: string;
  reference: string;
}

export const EMPTY_FORM: TransferForm = { payeeName: '', sortCode: '', accountNumber: '', amount: '', reference: '' };

const digits = (s: string) => s.replace(/\D/g, '');

/** Returns a message for the first problem, or null if the form is valid. */
export function validateForm(form: TransferForm): string | null {
  if (!form.payeeName.trim()) return "Enter the payee's name.";
  if (digits(form.sortCode).length !== 6) return 'A sort code has 6 digits.';
  if (digits(form.accountNumber).length !== 8) return 'An account number has 8 digits.';
  const amount = Number(form.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount greater than zero.';
  if (amount > 1_000_000) return 'That is above the online payment limit.';
  return null;
}

export function isKnownPayee(known: PayeeRef[], payee: PayeeRef): boolean {
  return known.some((p) => digits(p.sortCode) === digits(payee.sortCode) && digits(p.accountNumber) === digits(payee.accountNumber));
}

export type TransferOutcome =
  | { kind: 'invalid'; error: string }
  | { kind: 'error'; message: string }
  | { kind: 'sent'; transfer: TransferIntent }
  | { kind: 'check'; transfer: TransferIntent; profile: ProfileInfo; cop: CopInfo; reasons: string[] };

export async function evaluateTransfer(form: TransferForm, fetchImpl: typeof fetch = fetch): Promise<TransferOutcome> {
  const error = validateForm(form);
  if (error) return { kind: 'invalid', error };

  const payee: PayeeRef = { name: form.payeeName.trim(), sortCode: form.sortCode.trim(), accountNumber: form.accountNumber.trim() };
  let profile;
  try {
    profile = await fetchProfile(CUSTOMER_ID, fetchImpl);
  } catch {
    return { kind: 'error', message: "We couldn't reach the bank just now, so nothing has been sent. Please try again." };
  }

  const cop: CopInfo = await checkPayee(payee, fetchImpl).catch(() => ({ result: 'UNAVAILABLE' as const, accountType: null }));
  const transfer: TransferIntent = {
    customerId: CUSTOMER_ID,
    amountGBP: Number(form.amount),
    payee,
    newPayee: !isKnownPayee(profile.knownPayees, payee),
    reference: form.reference.trim(),
  };

  const gate = precheck({ amountGBP: transfer.amountGBP, newPayee: transfer.newPayee, copResult: cop.result, max90dOutgoingGBP: profile.max90dOutgoingGBP });
  return gate.requiresVoiceCheck ? { kind: 'check', transfer, profile, cop, reasons: gate.reasons } : { kind: 'sent', transfer };
}
