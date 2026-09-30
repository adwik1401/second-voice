import { describe, expect, it } from 'vitest';
import { classifyByRules } from '../core/coaching-rules';
import { COACHED_CALL, GROUP_LABEL, LINES, lineById } from './lines';
import { pickVoice, type VoiceInfo } from './speech';

describe('the scammer script', () => {
  const coaching = LINES.filter((l) => l.group !== 'benign');
  const benign = LINES.filter((l) => l.group === 'benign');

  it.each(coaching.map((l) => ({ ...l })))('the detector catches "$text"', (line) => {
    const verdict = classifyByRules([line.text]);
    expect(verdict, `not detected: ${line.text}`).not.toBeNull();
    expect(verdict!.confidence).toBeGreaterThanOrEqual(0.7); // the level the agent and the scorer act on
  });

  it.each(benign.map((l) => ({ ...l })))('the detector leaves "$text" alone (no false alarm)', (line) => {
    expect(classifyByRules([line.text])).toBeNull();
  });

  it('has unique ids, every group labelled, and a script of each kind', () => {
    expect(new Set(LINES.map((l) => l.id)).size).toBe(LINES.length);
    for (const l of LINES) expect(GROUP_LABEL[l.group]).toBeTruthy();
    expect(new Set(coaching.map((l) => l.group))).toEqual(new Set(['script', 'secrecy', 'urgency', 'authority']));
    expect(benign.length).toBeGreaterThanOrEqual(3);
  });

  it('the ready-made coached call uses real lines, and as a whole raises the confidence (lines stack)', () => {
    const lines = COACHED_CALL.map((id) => lineById(id));
    expect(lines.every(Boolean)).toBe(true);
    expect(classifyByRules(lines.map((l) => l!.text))!.confidence).toBe(0.9);
  });
});

describe('pickVoice', () => {
  const v = (name: string, lang: string): VoiceInfo => ({ voiceURI: name, name, lang });

  it('prefers an English male-sounding voice', () => {
    expect(pickVoice([v('Microsoft Zira', 'en-US'), v('Microsoft David', 'en-US'), v('Anna', 'de-DE')])?.name).toBe('Microsoft David');
  });

  it('falls back to any English voice, then to the first voice', () => {
    expect(pickVoice([v('Anna', 'de-DE'), v('Samantha', 'en-GB')])?.name).toBe('Samantha');
    expect(pickVoice([v('Anna', 'de-DE')])?.name).toBe('Anna');
  });

  it('returns undefined when there are no voices', () => {
    expect(pickVoice([])).toBeUndefined();
  });

  it('accepts en_US style language tags', () => {
    expect(pickVoice([v('Daniel', 'en_GB')])?.name).toBe('Daniel');
  });
});
