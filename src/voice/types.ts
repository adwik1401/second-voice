/** Client-side domain types for the Voice Check. (The server's mock-bank types stay in api/_lib — no cross-imports.) */
import type { CopResult } from '../core/types';

export interface PayeeRef {
  name: string;
  sortCode: string;
  accountNumber: string;
}

/** What the customer is trying to do, as entered in the Larkmoor transfer form. */
export interface TransferIntent {
  customerId: string;
  amountGBP: number;
  payee: PayeeRef;
  newPayee: boolean;
  reference: string;
}

export interface ProfileInfo {
  tenureYears: number;
  typicalPaymentsGBP: { low: number; median: number; high: number };
  max90dOutgoingGBP: number;
}

export interface CopInfo {
  result: CopResult;
  accountType: 'personal' | 'business' | null;
  suggestedName?: string;
}

export interface PayeeRiskInfo {
  accountAgeDays: number;
  muleRiskScore: number;
  priorReports: number;
}

/** The four questions the agent works through; `record_answer` is constrained to these. */
export type AnswerTopic = 'purpose' | 'relationship' | 'contact_method' | 'pressure';
export const ANSWER_TOPICS: readonly AnswerTopic[] = ['purpose', 'relationship', 'contact_method', 'pressure'];

export type PressureCue = 'urgency' | 'secrecy' | 'authority';

export type LineRole = 'customer' | 'agent';
export interface TranscriptLine {
  role: LineRole;
  text: string;
  /** Wall-clock ms. */
  at: number;
}
