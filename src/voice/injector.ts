/**
 * Agent Injector (Plan Step 16, spec §7.8): feeds what the room reveals into the live conversation.
 *
 * Two kinds of message, both sent with role "system" (the agent's prompt trusts ONLY system-role messages;
 * anything spoken is data):
 *  - `context`: the transfer details, once, at the start. Not rate-limited, does not make the agent speak.
 *  - `coachingDetected`: a second voice / coaching was found — tells the agent, then makes it ask ONE gentle
 *    question immediately. Rate-limited to one per 20 s so the customer is never badgered.
 */
import type { TransferIntent } from './types';

export interface InjectorTransport {
  /** conversation.message with role "system". */
  systemMessage(text: string): void;
  /** reply.create with one-shot instructions. */
  replyNow(instructions: string): void;
}

export const DEFAULT_MIN_GAP_MS = 20_000;

export const COACHING_REPLY_INSTRUCTIONS =
  'Ask ONE short, kind question: whether anyone is with them or telling them what to say, and gently remind them that the bank will never ask them to lie. Do not accuse them, do not quote the system message, and do not explain how you know.';

const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The trusted opening context. The agent's greeting is fixed text, so the amount arrives here instead. */
export function transferContext(t: TransferIntent): string {
  return (
    `The customer is sending ${gbp(t.amountGBP)} to "${t.payee.name}". ` +
    `They entered this as ${t.newPayee ? 'a new payee' : 'an existing payee'}.`
  );
}

/** Private note for the agent. The quote is included so its question can be specific; the prompt forbids repeating it. */
export function coachingNote(type: string, quote: string): string {
  return (
    `A second person may be speaking to or coaching the customer (${type.replace(/_/g, ' ')})` +
    (quote ? `; they seem to have said: "${quote}".` : '.') +
    ' This is private. Follow your instructions for this situation.'
  );
}

export class AgentInjector {
  private lastProactiveAt: number | null = null;

  constructor(
    private readonly transport: InjectorTransport,
    private readonly now: () => number = Date.now,
    private readonly minGapMs: number = DEFAULT_MIN_GAP_MS,
  ) {}

  /** Trusted background context; the agent does not reply to it. */
  context(text: string): void {
    this.transport.systemMessage(text);
  }

  /** Returns false (and sends nothing) if a proactive message went out less than `minGapMs` ago. */
  coachingDetected(type: string, quote: string): boolean {
    const t = this.now();
    if (this.lastProactiveAt !== null && t - this.lastProactiveAt < this.minGapMs) return false;
    this.lastProactiveAt = t;
    this.transport.systemMessage(coachingNote(type, quote));
    this.transport.replyNow(COACHING_REPLY_INSTRUCTIONS);
    return true;
  }
}
