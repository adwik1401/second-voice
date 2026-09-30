import { getCustomerProfile } from '../_lib/bank.js';
import { badRequest, json, notFound } from '../_lib/http.js';

/** GET /api/bank/profile?customerId=… — tenure, typical payments, 90-day maximum, known payees (tool: get_customer_profile). */
export function GET(request: Request): Response {
  const customerId = new URL(request.url).searchParams.get('customerId');
  if (!customerId) return badRequest('customerId is required');
  const profile = getCustomerProfile(customerId);
  return profile ? json(profile) : notFound('unknown customer');
}
