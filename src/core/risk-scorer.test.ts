import { describe, expect, it } from 'vitest';
import { score, type Decision, type RiskSignals } from './risk-scorer';

const neutral: RiskSignals = {
  newPayee: false,
  copResult: 'MATCH',
  payeeAccountAgeDays: null,
  payeeMuleRisk: null,
  amountVsMax90d: null,
  purposeContradictsPayee: false,
  pressureCues: 0,
  backgroundSpeech: false,
  coachingConfidence: null,
  echo: false,
  toolFailed: false,
  toldToLie: false,
  safeAccount: false,
  contactedByAuthority: false,
};
const sig = (over: Partial<RiskSignals>): RiskSignals => ({ ...neutral, ...over });

describe('points table (spec §7.7)', () => {
  const cases: [string, Partial<RiskSignals>, number][] = [
    ['new payee', { newPayee: true }, 10],
    ['CoP close match', { copResult: 'CLOSE_MATCH' }, 10],
    ['CoP no match', { copResult: 'NO_MATCH' }, 20],
    ['CoP unavailable adds nothing itself (the caller flags toolFailed)', { copResult: 'UNAVAILABLE' }, 0],
    ['account age 29 days', { payeeAccountAgeDays: 29 }, 15],
    ['account age 30 days', { payeeAccountAgeDays: 30 }, 0],
    ['mule risk 0.7', { payeeMuleRisk: 0.7 }, 20],
    ['mule risk 0.69', { payeeMuleRisk: 0.69 }, 0],
    ['amount exactly 3× max', { amountVsMax90d: 3 }, 10],
    ['amount just under 3× max', { amountVsMax90d: 2.99 }, 0],
    ['purpose contradicts payee', { purposeContradictsPayee: true }, 15],
    ['one pressure cue', { pressureCues: 1 }, 10],
    ['two pressure cues', { pressureCues: 2 }, 20],
    ['three pressure cues are capped at 20', { pressureCues: 3 }, 20],
    ['background speech', { backgroundSpeech: true }, 10],
    ['coaching at confidence 0.7', { coachingConfidence: 0.7 }, 25],
    ['coaching at confidence 0.69', { coachingConfidence: 0.69 }, 0],
    ['echo', { echo: true }, 30],
    ['a failed bank tool', { toolFailed: true }, 10],
  ];
  // Lift lines (coaching floor, escalation rule) are audit adjustments, not table rows — measure the table alone.
  const tablePoints = (over: Partial<RiskSignals>) =>
    score(sig(over))
      .reasons.filter((r) => !/^(Minimum hold|Escalation rule)/.test(r.label))
      .reduce((sum, r) => sum + r.points, 0);

  it.each(cases.map(([name, over, points]) => ({ name, over, points })))('$name → $points points', ({ over, points }) => {
    expect(tablePoints(over)).toBe(points);
  });

  it('every reason line carries its own points, and they sum to the score', () => {
    const r = score(sig({ newPayee: true, copResult: 'NO_MATCH', backgroundSpeech: true }));
    expect(r.reasons.map((x) => x.points)).toEqual([10, 20, 10]);
    expect(r.reasons.reduce((s, x) => s + x.points, 0)).toBe(r.score);
  });

  it('caps the score at 100', () => {
    const r = score(
      sig({
        newPayee: true,
        copResult: 'NO_MATCH',
        payeeAccountAgeDays: 1,
        payeeMuleRisk: 0.9,
        amountVsMax90d: 5,
        purposeContradictsPayee: true,
        pressureCues: 3,
        backgroundSpeech: true,
        coachingConfidence: 0.95,
        echo: true,
        toolFailed: true,
      }),
    );
    expect(r.score).toBe(100);
  });
});

describe('decision bands', () => {
  it('RELEASEs a low score — the spec’s S2 case (new payee + benign background chatter = 20)', () => {
    const r = score(sig({ newPayee: true, backgroundSpeech: true }));
    expect(r).toMatchObject({ score: 20, decision: 'RELEASE', offerHuman: false, hardTrigger: null });
  });

  it('starts a COOLING_OFF hold at exactly 30 (echo alone, which is not a hard trigger)', () => {
    expect(score(sig({ echo: true }))).toMatchObject({ score: 30, decision: 'COOLING_OFF', hardTrigger: null });
  });

  it('stays in COOLING_OFF at 60', () => {
    const r = score(sig({ payeeMuleRisk: 0.8, purposeContradictsPayee: true, payeeAccountAgeDays: 5, newPayee: true }));
    expect(r).toMatchObject({ score: 60, decision: 'COOLING_OFF' });
  });

  it('ESCALATEs at exactly 70 without any hard trigger', () => {
    const r = score(
      sig({ payeeMuleRisk: 0.8, purposeContradictsPayee: true, payeeAccountAgeDays: 5, newPayee: true, copResult: 'CLOSE_MATCH' }),
    );
    expect(r).toMatchObject({ score: 70, decision: 'ESCALATE', hardTrigger: null });
  });
});

describe('hard triggers force ESCALATE regardless of score', () => {
  it('coaching + echo (55 points on the table) escalates, and the displayed score is lifted to 70 with an audit line', () => {
    const r = score(sig({ coachingConfidence: 0.9, echo: true }));
    expect(r.decision).toBe('ESCALATE');
    expect(r.score).toBe(70);
    expect(r.hardTrigger).toMatch(/repeated/);
    expect(r.reasons.at(-1)).toMatchObject({ points: 15 });
    expect(r.reasons.at(-1)!.label).toMatch(/^Escalation rule/);
  });

  it.each([
    ['told to lie', { toldToLie: true }],
    ['safe account', { safeAccount: true }],
    ['contacted by police or the bank', { contactedByAuthority: true }],
  ] as [string, Partial<RiskSignals>][])('%s escalates even with nothing else wrong', (_name, over) => {
    const r = score(sig(over));
    expect(r).toMatchObject({ decision: 'ESCALATE', score: 70, offerHuman: true });
    expect(r.hardTrigger).not.toBeNull();
  });

  it('coaching alone is not a hard trigger', () => {
    expect(score(sig({ coachingConfidence: 0.9 })).hardTrigger).toBeNull();
  });
});

describe('coaching floor', () => {
  it('holds a coached customer even when nothing else scored (25 points alone would RELEASE)', () => {
    const r = score(sig({ coachingConfidence: 0.9 }));
    expect(r).toMatchObject({ decision: 'COOLING_OFF', score: 30, offerHuman: true, hardTrigger: null });
    expect(r.reasons.map((x) => x.points)).toEqual([25, 5]);
    expect(r.reasons[1].label).toMatch(/coaching was detected/);
  });

  it('does not apply below the confidence threshold', () => {
    expect(score(sig({ coachingConfidence: 0.69 })).decision).toBe('RELEASE');
  });

  it('leaves a higher score untouched', () => {
    const r = score(sig({ coachingConfidence: 0.9, newPayee: true, copResult: 'NO_MATCH' }));
    expect(r).toMatchObject({ decision: 'COOLING_OFF', score: 55 });
    expect(r.reasons).toHaveLength(3);
  });
});

describe('customer-protective invariants', () => {
  // Every combination of several signals, including hard triggers.
  const grid: RiskSignals[] = [];
  for (let mask = 0; mask < 64; mask++) {
    for (const coachingConfidence of [null, 0.9]) {
      for (const copResult of ['MATCH', 'NO_MATCH'] as const) {
        grid.push(
          sig({
            newPayee: !!(mask & 1),
            purposeContradictsPayee: !!(mask & 2),
            backgroundSpeech: !!(mask & 4),
            echo: !!(mask & 8),
            toolFailed: !!(mask & 16),
            toldToLie: !!(mask & 32),
            coachingConfidence,
            copResult,
          }),
        );
      }
    }
  }
  const severity: Record<Decision, number> = { RELEASE: 0, COOLING_OFF: 1, ESCALATE: 2 };

  it('never produces anything but RELEASE, COOLING_OFF or ESCALATE (there is no flat refusal)', () => {
    for (const s of grid) expect(['RELEASE', 'COOLING_OFF', 'ESCALATE']).toContain(score(s).decision);
  });

  it('offers a human on every outcome except RELEASE', () => {
    for (const s of grid) {
      const r = score(s);
      expect(r.offerHuman).toBe(r.decision !== 'RELEASE');
    }
  });

  it('always explains the score: reason points sum to it (except when capped at 100)', () => {
    for (const s of grid) {
      const r = score(s);
      const sum = r.reasons.reduce((t, x) => t + x.points, 0);
      if (r.score < 100) expect(sum).toBe(r.score);
      else expect(sum).toBeGreaterThanOrEqual(100);
    }
  });

  it('keeps the score within 0..100 and consistent with the decision', () => {
    for (const s of grid) {
      const r = score(s);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      if (r.decision === 'ESCALATE') expect(r.score).toBeGreaterThanOrEqual(70);
      if (r.decision === 'RELEASE') expect(r.score).toBeLessThan(30);
    }
  });

  it('never RELEASEs a confidently detected coach', () => {
    for (const s of grid) {
      if (s.coachingConfidence !== null) expect(score(s).decision).not.toBe('RELEASE');
    }
  });

  it('is monotonic: detecting an echo, or a second voice, never makes the outcome less severe', () => {
    for (const s of grid) {
      for (const worse of [{ echo: true }, { backgroundSpeech: true }, { safeAccount: true }] as Partial<RiskSignals>[]) {
        expect(severity[score({ ...s, ...worse }).decision]).toBeGreaterThanOrEqual(severity[score(s).decision]);
      }
    }
  });
});
