/** Thin typed wrappers over our mock-bank endpoints (api/bank/*). */
import type { CopInfo, PayeeRef, ProfileInfo } from '../voice/types';

export interface ProfileResponse extends ProfileInfo {
  customerId: string;
  name: string;
  knownPayees: PayeeRef[];
}

async function getJson<T>(path: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(`${path} failed (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export const fetchProfile = (customerId: string, fetchImpl: typeof fetch = fetch) =>
  getJson<ProfileResponse>('/api/bank/profile', { customerId }, fetchImpl);

export const checkPayee = (payee: PayeeRef, fetchImpl: typeof fetch = fetch) =>
  getJson<CopInfo>('/api/bank/payee-check', { sortCode: payee.sortCode, accountNumber: payee.accountNumber, name: payee.name }, fetchImpl);
