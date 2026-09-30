import { describe, expect, it } from 'vitest';
import { analyzeCustomerText, purposeContradictsPayee } from './analysis';

describe('analyzeCustomerText — pressure cues', () => {
  it.each([
    ["It's very urgent, I need to do it today", ['urgency']],
    ["They said it's a secret, don't tell the bank", ['secrecy']],
    ['The police said to move it to a safe account', ['authority']],
    ["It's urgent and he said to keep this quiet", ['urgency', 'secrecy']],
  ] as [string, string[]][])('%s → %j', (text, cues) => {
    expect(analyzeCustomerText(text).pressure).toEqual(cues);
  });

  it('finds nothing in an ordinary answer', () => {
    expect(analyzeCustomerText("It's for my friend, I'm paying back what I owe her.")).toEqual({
      pressure: [],
      toldToLie: false,
      safeAccount: false,
      contactedByAuthority: false,
    });
  });

  it('handles curly apostrophes and capitals', () => {
    expect(analyzeCustomerText('He said DON’T TELL anyone').pressure).toContain('secrecy');
  });
});

describe('analyzeCustomerText — hard triggers', () => {
  it('flags being told what to say', () => {
    expect(analyzeCustomerText('He told me what to say to you').toldToLie).toBe(true);
    expect(analyzeCustomerText('I was told to say it is for a car').toldToLie).toBe(true);
  });

  it('flags a safe account (also a pressure cue: authority)', () => {
    const a = analyzeCustomerText('They want me to move the money to a safe account');
    expect(a.safeAccount).toBe(true);
    expect(a.pressure).toContain('authority');
  });

  it('flags an authority contacting the customer', () => {
    expect(analyzeCustomerText('My bank rang me yesterday and said my account was at risk').contactedByAuthority).toBe(true);
    expect(analyzeCustomerText('I got a call from the fraud team').contactedByAuthority).toBe(true);
    expect(analyzeCustomerText('The police phoned me this morning').contactedByAuthority).toBe(true);
  });

  it('does NOT flag the customer contacting the bank (we are the bank)', () => {
    expect(analyzeCustomerText('I called the bank earlier about my card').contactedByAuthority).toBe(false);
  });
});

describe('analyzeCustomerText — negation (live bug: an honest "nobody is pressuring me" raised a secrecy cue)', () => {
  it.each([
    'No, nobody is pressuring me and nobody asked me to keep it secret.',
    "It's not urgent, there's no deadline.",
    "The police haven't been in touch and I haven't heard from the fraud team.",
    'Nobody told me what to say.',
    "There's no safe account involved.",
    "No one from the bank called me.",
    "He didn't say it was confidential.",
  ])('raises nothing for: %s', (text) => {
    expect(analyzeCustomerText(text)).toEqual({ pressure: [], toldToLie: false, safeAccount: false, contactedByAuthority: false });
  });

  it.each([
    ['Keep it secret, he said.', 'secrecy'],
    ["He told me not to tell anyone.", 'secrecy'],
    ["They said it's urgent.", 'urgency'],
    ['The police phoned me.', 'authority'],
  ])('still raises the cue when it is real: %s', (text, cue) => {
    expect(analyzeCustomerText(text).pressure).toContain(cue);
  });

  it('never guards a direct instruction to hide things — "told me not to tell" IS the cue', () => {
    expect(analyzeCustomerText('He told me not to tell the bank why.').pressure).toContain('secrecy');
    expect(analyzeCustomerText("Don't tell the bank, he said.").pressure).toContain('secrecy');
  });

  it('checks every occurrence, not just the first (a negated mention followed by a real one still counts)', () => {
    expect(analyzeCustomerText('Nobody said keep it quiet. But then he said keep it secret.').pressure).toContain('secrecy');
  });
});

describe('purposeContradictsPayee', () => {
  it('flags a business purpose paid into a personal account (the demo scam)', () => {
    expect(purposeContradictsPayee('a deposit on a car from a dealer', 'personal')).toBe(true);
    expect(purposeContradictsPayee('paying an invoice for the builder', 'personal')).toBe(true);
  });

  it('accepts a business purpose paid to a business account (the legitimate plumber)', () => {
    expect(purposeContradictsPayee('the plumber for the new boiler', 'business')).toBe(false);
  });

  it('accepts a personal purpose paid to a personal account', () => {
    expect(purposeContradictsPayee("paying my friend back for dinner", 'personal')).toBe(false);
  });

  it('asserts nothing without the recipient’s account type', () => {
    expect(purposeContradictsPayee('a car from a dealer', null)).toBe(false);
  });
});
