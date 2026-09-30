import { checkPayee } from '../_lib/bank';
import { badRequest, json } from '../_lib/http';

/** GET /api/bank/payee-check?sortCode=…&accountNumber=…&name=… — Confirmation of Payee (tool: check_payee). */
export function GET(request: Request): Response {
  const q = new URL(request.url).searchParams;
  const sortCode = q.get('sortCode');
  const accountNumber = q.get('accountNumber');
  const name = q.get('name');
  if (!sortCode || !accountNumber || !name) return badRequest('sortCode, accountNumber and name are required');
  return json(checkPayee({ sortCode, accountNumber, name }));
}
