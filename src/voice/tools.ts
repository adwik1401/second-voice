/**
 * The six agent tools (Plan Step 15, spec §7.9), run in the browser against our /api/bank endpoints.
 * Each returns `{ result, isError }`; the agent client turns that into a `tool.result`. A failed bank check is
 * never fatal: it is reported to the agent ("could not be verified") and to the scorer (`toolFailed`, +10).
 * What goes back to the model is deliberately minimal: no scores, thresholds or reasons.
 */
import type { CheckState } from './check-state';
import { OUTCOME_EXPLANATION } from './outcome';
import type { RiskResult } from '../core/risk-scorer';
import { ANSWER_TOPICS, type AnswerTopic, type CopInfo, type PayeeRiskInfo, type ProfileInfo } from './types';

export interface ToolOutcome {
  result: unknown;
  isError: boolean;
}

export interface ToolDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  onHumanRequested?: (reason: string) => void;
  onDecision?: (decision: RiskResult) => void;
}

const UNVERIFIED: ToolOutcome = { result: { error: 'This could not be verified right now.' }, isError: true };

export function createToolRunner(state: CheckState, deps: ToolDeps = {}) {
  const { fetchImpl = fetch, now = Date.now } = deps;

  async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
    const res = await fetchImpl(`${path}?${new URLSearchParams(params)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  const payeeParams = () => ({ sortCode: state.transfer.payee.sortCode, accountNumber: state.transfer.payee.accountNumber });

  async function run(name: string, args: Record<string, unknown> = {}): Promise<ToolOutcome> {
    switch (name) {
      case 'get_customer_profile': {
        try {
          const profile = await getJson<ProfileInfo>('/api/bank/profile', { customerId: state.transfer.customerId });
          state.setProfile(profile);
          return {
            result: {
              tenureYears: profile.tenureYears,
              typicalPaymentsGBP: profile.typicalPaymentsGBP,
              largestPaymentLast90DaysGBP: profile.max90dOutgoingGBP,
            },
            isError: false,
          };
        } catch {
          state.markToolFailed();
          return UNVERIFIED;
        }
      }

      case 'check_payee': {
        // The transfer form already ran Confirmation of Payee; reuse it rather than calling again.
        let cop: CopInfo | null = state.cop;
        if (!cop || cop.result === 'UNAVAILABLE') {
          try {
            cop = await getJson<CopInfo>('/api/bank/payee-check', { ...payeeParams(), name: state.transfer.payee.name });
            state.setCop(cop);
          } catch {
            state.markToolFailed();
            return UNVERIFIED;
          }
        }
        // The scheme could not check this account: nothing is verified, so the scorer must know.
        if (cop.result === 'UNAVAILABLE') state.markToolFailed();
        return { result: cop, isError: false };
      }

      case 'get_payee_risk': {
        try {
          const risk = await getJson<PayeeRiskInfo>('/api/bank/payee-risk', payeeParams());
          state.setPayeeRisk(risk);
          return { result: risk, isError: false };
        } catch {
          state.markToolFailed();
          return UNVERIFIED;
        }
      }

      case 'record_answer': {
        const { topic, answer } = args;
        if (typeof topic !== 'string' || !ANSWER_TOPICS.includes(topic as AnswerTopic) || typeof answer !== 'string' || !answer.trim()) {
          return { result: { error: 'topic must be one of purpose, relationship, contact_method, pressure, with a non-empty answer.' }, isError: true };
        }
        state.recordAnswer(topic as AnswerTopic, answer.trim().slice(0, 500), now());
        return { result: { recorded: true }, isError: false };
      }

      case 'decide_payment': {
        const decision = state.decide();
        deps.onDecision?.(decision);
        // Only the outcome and the kind explanation go back — never the score or reasons.
        return {
          result: { decision: decision.decision, explanation: OUTCOME_EXPLANATION[decision.decision], offerHuman: decision.offerHuman },
          isError: false,
        };
      }

      case 'request_human': {
        const reason = typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim().slice(0, 200) : 'customer asked for a person';
        state.requestHuman(reason);
        deps.onHumanRequested?.(reason);
        return { result: { connected: true, message: 'A colleague will call the customer shortly.' }, isError: false };
      }

      default:
        return { result: { error: `Unknown tool: ${name}` }, isError: true };
    }
  }

  return run;
}
