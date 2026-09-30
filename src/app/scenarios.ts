import type { TransferForm } from './transfer';

/** One-click fills for the four demo scenarios (spec §11). The data lives in api/_lib/bank-data.ts. */
export interface Scenario {
  id: 'S1' | 'S2' | 'S3' | 'S4';
  label: string;
  form: TransferForm;
}

export const SCENARIOS: Scenario[] = [
  { id: 'S1', label: '£400 to Priya Shah (known payee)', form: { payeeName: 'Priya Shah', sortCode: '20-45-11', accountNumber: '40112233', amount: '400', reference: 'Dinner money' } },
  { id: 'S2', label: '£1,200 to a plumber (new, legitimate)', form: { payeeName: 'Harriet Lane Plumbing Ltd', sortCode: '20-12-66', accountNumber: '60245518', amount: '1200', reference: 'Boiler repair' } },
  { id: 'S3', label: '£2,500 to an investment firm (scam)', form: { payeeName: 'Global Investment Partners', sortCode: '99-56-78', accountNumber: '50294817', amount: '2500', reference: 'Investment' } },
  { id: 'S4', label: '£8,000 to a car dealer (coached scam)', form: { payeeName: 'Northgate Autos Ltd', sortCode: '99-12-34', accountNumber: '71829035', amount: '8000', reference: 'Car deposit' } },
];
