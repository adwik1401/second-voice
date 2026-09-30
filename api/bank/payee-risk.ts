import { getPayeeRisk } from '../_lib/bank';
import { badRequest, json, notFound } from '../_lib/http';

/** GET /api/bank/payee-risk?sortCode=…&accountNumber=… — account age, mule-risk score, prior reports (tool: get_payee_risk). */
export function GET(request: Request): Response {
  const q = new URL(request.url).searchParams;
  const sortCode = q.get('sortCode');
  const accountNumber = q.get('accountNumber');
  if (!sortCode || !accountNumber) return badRequest('sortCode and accountNumber are required');
  const risk = getPayeeRisk(sortCode, accountNumber);
  return risk ? json(risk) : notFound('unknown account');
}
