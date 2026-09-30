/**
 * Fictional data for "Larkmoor Bank". Nothing here is real: names, accounts and sort codes (all 99-xx-xx or
 * invented) exist only to drive the demo scenarios (spec §11). Served by the mock endpoints under api/bank/.
 *
 * Scenario map (risk points from src/core/risk-scorer.ts):
 *   S1  £400 to Priya Shah           known payee, under £1,000            → no Voice Check
 *   S2  £1,200 to Harriet Lane       new but legitimate (CoP match)       → new payee 10 (+ chatter 10) = 20 → RELEASE
 *   S3  £2,500 to Global Invest      bank signals alone                   → hold or escalate with no coach at all
 *   S4  £8,000 to "Northgate Autos"  bank signals alone ≈ 45–60 (a hold)  → the coach tips it to ESCALATE
 */

export interface KnownPayee {
  name: string;
  sortCode: string;
  accountNumber: string;
}

export interface CustomerProfile {
  customerId: string;
  name: string;
  tenureYears: number;
  typicalPaymentsGBP: { low: number; median: number; high: number };
  /** Largest outgoing payment in the last 90 days. */
  max90dOutgoingGBP: number;
  knownPayees: KnownPayee[];
}

export interface PayeeAccount {
  sortCode: string;
  accountNumber: string;
  /** The name the receiving bank holds — what Confirmation of Payee compares against. */
  holderName: string;
  accountType: 'personal' | 'business';
  accountAgeDays: number;
  /** 0..1; ≥ 0.7 means a high mule-risk score. */
  muleRisk: number;
  priorReports: number;
}

export const CUSTOMERS: CustomerProfile[] = [
  {
    customerId: 'cust-sarah',
    name: 'Sarah Mitchell',
    tenureYears: 6,
    typicalPaymentsGBP: { low: 40, median: 120, high: 400 },
    // One earlier large payment (a holiday deposit in July), so £8,000 is big but not ≥ 3× this.
    max90dOutgoingGBP: 4_200,
    knownPayees: [{ name: 'Priya Shah', sortCode: '20-45-11', accountNumber: '40112233' }],
  },
];

export const PAYEE_ACCOUNTS: PayeeAccount[] = [
  {
    sortCode: '20-45-11',
    accountNumber: '40112233',
    holderName: 'Priya Shah',
    accountType: 'personal',
    accountAgeDays: 2_190,
    muleRisk: 0.03,
    priorReports: 0,
  },
  {
    sortCode: '20-12-66',
    accountNumber: '60245518',
    holderName: 'Harriet Lane Plumbing Ltd',
    accountType: 'business',
    accountAgeDays: 1_800,
    muleRisk: 0.04,
    priorReports: 0,
  },
  {
    // The demo scam: sold as a car dealer, actually a personal account opened days ago.
    sortCode: '99-12-34',
    accountNumber: '71829035',
    holderName: 'D M Okafor',
    accountType: 'personal',
    accountAgeDays: 9,
    muleRisk: 0.62,
    priorReports: 1,
  },
  {
    sortCode: '99-56-78',
    accountNumber: '50294817',
    holderName: 'Global Invest Partners Ltd',
    accountType: 'business',
    accountAgeDays: 12,
    muleRisk: 0.78,
    priorReports: 3,
  },
];
