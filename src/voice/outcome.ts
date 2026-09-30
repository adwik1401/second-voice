/**
 * Customer-facing wording for each outcome. Read aloud by the agent and shown on screen.
 * Kind and non-accusatory; NEVER includes the score, thresholds or which checks ran — revealing the scoring
 * would let a coach optimise their script against it (spec §7.7, agent prompt "Rules you never break").
 */
import type { Decision } from '../core/risk-scorer';

export const OUTCOME_TITLE: Record<Decision, string> = {
  RELEASE: 'Payment approved',
  COOLING_OFF: 'Payment paused for 24 hours',
  ESCALATE: 'A specialist will call you',
};

export const OUTCOME_EXPLANATION: Record<Decision, string> = {
  RELEASE: 'Thanks, everything looks in order, so you can go ahead with this payment.',
  COOLING_OFF:
    "I'd like to pause this payment for 24 hours as a safety precaution. It isn't a refusal. A colleague can go through it with you, and you can speak to them at any time.",
  ESCALATE:
    "Before this goes ahead I'd like a specialist from our fraud team to speak with you. It's a short, routine safety step, and I'll arrange it now.",
};
