/**
 * The scammer's script for the demo (Plan Step 24): what the "coach" says on speakerphone next to the customer.
 * Every coaching line here is asserted by a test to be caught by the detector, so the demo cannot silently rot.
 * The benign lines exist for the false-alarm check: ordinary household talk must NOT look like coaching.
 */

export type LineGroup = 'script' | 'secrecy' | 'urgency' | 'authority' | 'benign';

export interface SimLine {
  id: string;
  group: LineGroup;
  text: string;
}

export const GROUP_LABEL: Record<LineGroup, string> = {
  script: 'Feeding the answers',
  secrecy: 'Keeping it secret',
  urgency: 'Rushing the customer',
  authority: 'Posing as the bank',
  benign: 'Ordinary chatter (must NOT be flagged)',
};

export const LINES: SimLine[] = [
  { id: 'script-1', group: 'script', text: "Tell her it's for a car deposit. Don't mention me." },
  { id: 'script-2', group: 'script', text: "If they ask, tell them you've used him before and you're happy with him." },
  { id: 'script-3', group: 'script', text: "Say you've known him for years, and that it's urgent." },
  { id: 'secrecy-1', group: 'secrecy', text: "Don't tell the bank why. Just say it's for your client." },
  { id: 'secrecy-2', group: 'secrecy', text: "Keep this between us, and tell them it's a gift for a relative." },
  { id: 'secrecy-3', group: 'secrecy', text: "Don't let them talk you out of it, you're nearly there." },
  { id: 'urgency-1', group: 'urgency', text: "Hurry up, just send it, they're waiting for the money." },
  { id: 'authority-1', group: 'authority', text: 'This is the fraud team at your bank. Move the money to a safe account now.' },
  { id: 'benign-1', group: 'benign', text: "Yeah, I'll be done in five minutes. Can you put the kettle on?" },
  { id: 'benign-2', group: 'benign', text: 'Dinner will be ready at seven.' },
  { id: 'benign-3', group: 'benign', text: "Can you turn the telly down a bit, I'm on the phone." },
];

/** A ready-made coached call: played in order with a pause between lines, so a demo needs one tap. */
export const COACHED_CALL: string[] = ['script-1', 'secrecy-1', 'script-3'];
export const COACHED_CALL_GAP_MS = 9000;

export const lineById = (id: string): SimLine | undefined => LINES.find((l) => l.id === id);
