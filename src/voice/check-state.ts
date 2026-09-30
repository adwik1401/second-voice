/**
 * Everything the Voice Check knows about one transfer, accumulated as the conversation goes on
 * (Plan Steps 13–17). The risk scorer reads it through `toRiskSignals()`; the Fraud Officer Panel and the
 * audit record read `snapshot()`. A small mutable class with change notification — the React UI subscribes.
 */
import { score, type RiskResult, type RiskSignals } from '../core/risk-scorer';
import { analyzeCustomerText, purposeContradictsPayee } from './analysis';
import type { AnswerTopic, CopInfo, PayeeRiskInfo, PressureCue, ProfileInfo, TransferIntent } from './types';

export interface CoachEvidence {
  at: number;
  source: 'rules' | 'llm' | 'echo' | 'room_only';
  type: string;
  quote: string;
  confidence: number;
}

export interface CheckSnapshot {
  transfer: TransferIntent;
  profile: ProfileInfo | null;
  cop: CopInfo | null;
  payeeRisk: PayeeRiskInfo | null;
  answers: { topic: AnswerTopic; answer: string; at: number }[];
  pressure: PressureCue[];
  toldToLie: boolean;
  safeAccount: boolean;
  contactedByAuthority: boolean;
  purposeContradictsPayee: boolean;
  backgroundSpeech: boolean;
  coachingConfidence: number | null;
  echo: boolean;
  toolFailed: boolean;
  humanRequested: string | null;
  coachEvidence: CoachEvidence[];
  /** Live score so the panel's gauge moves as evidence arrives; `decision` is set once the check concludes. */
  risk: RiskResult;
  decision: RiskResult | null;
}

export class CheckState {
  profile: ProfileInfo | null = null;
  cop: CopInfo | null = null;
  payeeRisk: PayeeRiskInfo | null = null;
  readonly answers: { topic: AnswerTopic; answer: string; at: number }[] = [];
  private readonly pressure = new Set<PressureCue>();
  toldToLie = false;
  safeAccount = false;
  contactedByAuthority = false;
  purposeContradictsPayee = false;
  backgroundSpeech = false;
  coachingConfidence: number | null = null;
  echo = false;
  toolFailed = false;
  humanRequested: string | null = null;
  readonly coachEvidence: CoachEvidence[] = [];
  decision: RiskResult | null = null;

  private readonly listeners = new Set<() => void>();

  constructor(readonly transfer: TransferIntent) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  // ---- facts from the bank tools -------------------------------------------------------------------

  setProfile(profile: ProfileInfo) {
    this.profile = profile;
    this.emit();
  }
  setCop(cop: CopInfo) {
    this.cop = cop;
    this.recomputeContradiction();
    this.emit();
  }
  setPayeeRisk(risk: PayeeRiskInfo) {
    this.payeeRisk = risk;
    this.emit();
  }
  /** A bank check failed, so something stays unverified (+10 points, spec §7.7). */
  markToolFailed() {
    this.toolFailed = true;
    this.emit();
  }

  // ---- what the customer says ----------------------------------------------------------------------

  /** Mine a customer utterance for pressure cues and hard triggers. Called for EVERY customer transcript. */
  absorbCustomerText(text: string) {
    const a = analyzeCustomerText(text);
    for (const cue of a.pressure) this.pressure.add(cue);
    this.toldToLie ||= a.toldToLie;
    this.safeAccount ||= a.safeAccount;
    this.contactedByAuthority ||= a.contactedByAuthority;
    this.emit();
  }

  /**
   * Stores the agent's record of an answer. It is deliberately NOT mined for cues: it is the agent's paraphrase
   * ("nobody is asking them to keep it secret"), which can name a cue only to deny it, and every line the customer
   * actually said is already mined (`absorbCustomerText`). Found live: an honest customer was flagged for secrecy.
   */
  recordAnswer(topic: AnswerTopic, answer: string, at: number) {
    this.answers.push({ topic, answer, at });
    if (topic === 'purpose') this.recomputeContradiction();
    this.emit();
  }

  private recomputeContradiction() {
    const purpose = this.answers.filter((a) => a.topic === 'purpose').at(-1)?.answer;
    this.purposeContradictsPayee = purpose !== undefined && purposeContradictsPayee(purpose, this.cop?.accountType ?? null);
  }

  // ---- coaching evidence ---------------------------------------------------------------------------

  /** Records coaching evidence; the scorer uses the highest confidence seen (and acts at ≥ 0.7). */
  noteCoaching(evidence: CoachEvidence) {
    this.coachEvidence.push(evidence);
    this.coachingConfidence = Math.max(this.coachingConfidence ?? 0, evidence.confidence);
    this.emit();
  }
  noteEcho(evidence: CoachEvidence) {
    this.coachEvidence.push(evidence);
    this.echo = true;
    this.emit();
  }
  /** Room-only speech qualified by a tie-breaker: a second voice, not coaching on its own (no points beyond +10). */
  noteRoomOnly(evidence: CoachEvidence) {
    this.coachEvidence.push(evidence);
    this.backgroundSpeech = true;
    this.emit();
  }
  noteBackgroundSpeech() {
    this.backgroundSpeech = true;
    this.emit();
  }
  requestHuman(reason: string) {
    this.humanRequested = reason;
    this.emit();
  }

  // ---- scoring -------------------------------------------------------------------------------------

  toRiskSignals(): RiskSignals {
    const max = this.profile?.max90dOutgoingGBP ?? 0;
    return {
      newPayee: this.transfer.newPayee,
      // No Confirmation of Payee result is treated as unverified, never as a match.
      copResult: this.cop?.result ?? 'UNAVAILABLE',
      payeeAccountAgeDays: this.payeeRisk?.accountAgeDays ?? null,
      payeeMuleRisk: this.payeeRisk?.muleRiskScore ?? null,
      amountVsMax90d: max > 0 ? this.transfer.amountGBP / max : null,
      purposeContradictsPayee: this.purposeContradictsPayee,
      pressureCues: this.pressure.size,
      backgroundSpeech: this.backgroundSpeech,
      coachingConfidence: this.coachingConfidence,
      echo: this.echo,
      toolFailed: this.toolFailed,
      toldToLie: this.toldToLie,
      safeAccount: this.safeAccount,
      contactedByAuthority: this.contactedByAuthority,
    };
  }

  /** Concludes the check with the scorer's decision. */
  decide(): RiskResult {
    this.decision = score(this.toRiskSignals());
    this.emit();
    return this.decision;
  }

  /** Safe fallback when the call cannot continue: hold, never release (spec §9). `reason` is the audit line. */
  decideInterrupted(reason = 'Voice check was interrupted, so the payment is held'): RiskResult {
    const scored = score(this.toRiskSignals());
    this.decision =
      scored.decision === 'RELEASE'
        ? {
            ...scored,
            decision: 'COOLING_OFF',
            score: Math.max(scored.score, 30),
            reasons: [...scored.reasons, { label: reason, points: Math.max(0, 30 - scored.score) }],
            offerHuman: true,
          }
        : scored;
    this.emit();
    return this.decision;
  }

  snapshot(): CheckSnapshot {
    return {
      transfer: this.transfer,
      profile: this.profile,
      cop: this.cop,
      payeeRisk: this.payeeRisk,
      answers: [...this.answers],
      pressure: [...this.pressure],
      toldToLie: this.toldToLie,
      safeAccount: this.safeAccount,
      contactedByAuthority: this.contactedByAuthority,
      purposeContradictsPayee: this.purposeContradictsPayee,
      backgroundSpeech: this.backgroundSpeech,
      coachingConfidence: this.coachingConfidence,
      echo: this.echo,
      toolFailed: this.toolFailed,
      humanRequested: this.humanRequested,
      coachEvidence: [...this.coachEvidence],
      risk: score(this.toRiskSignals()),
      decision: this.decision,
    };
  }
}
