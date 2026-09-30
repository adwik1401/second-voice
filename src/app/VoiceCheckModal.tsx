/**
 * The customer's view of a Voice Check (Plan Step 13): consent → live conversation → outcome.
 * All logic lives in VoiceCheck (src/voice); this component only renders it and forwards button presses.
 * The customer NEVER sees scores, reasons or what was detected — only the kind outcome wording.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { OUTCOME_EXPLANATION, OUTCOME_TITLE } from '../voice/outcome';
import type { VoiceCheck } from '../voice/voice-check';

const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ICON = { RELEASE: '✅', COOLING_OFF: '⏸️', ESCALATE: '📞' } as const;

export interface VoiceCheckModalProps {
  check: VoiceCheck;
  /** Why the check was triggered, from the precheck (shown on the consent screen). */
  reasons: string[];
  /** Called when the customer closes the modal; `proceed` is true only for an approved payment they confirmed. */
  onClose: (result: { proceed: boolean }) => void;
}

export default function VoiceCheckModal({ check, reasons, onClose }: VoiceCheckModalProps) {
  useSyncExternalStore(check.subscribe.bind(check), () => check.version);
  const decision = check.state.decision;
  const { transfer } = check;

  const transcriptEnd = useRef<HTMLDivElement>(null);
  // Braces matter: an effect must return nothing or a cleanup function, and newer Chrome's scrollIntoView() returns a
  // Promise — `useEffect(() => ref.scrollIntoView())` would hand React that Promise and crash the component.
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'end' });
  }, [check.transcript.length]);

  const close = (proceed: boolean) => {
    check.end(); // releases the microphone whatever the outcome
    onClose({ proceed });
  };

  // ---- outcome ----
  if (decision) {
    const d = decision.decision;
    return (
      <Shell>
        <div className={`outcome ${d}`}>
          <div className="icon" aria-hidden>{ICON[d]}</div>
          <h2>{OUTCOME_TITLE[d]}</h2>
          <p>{check.failureReason ? "We couldn't complete the voice check, so your payment is on hold. A colleague will call you to go through it." : OUTCOME_EXPLANATION[d]}</p>
          {d === 'RELEASE' ? (
            <p className="muted">{gbp(transfer.amountGBP)} to {transfer.payee.name}</p>
          ) : (
            <p className="muted">Your reference is <span className="ref">{check.reference}</span>. Nothing has left your account.</p>
          )}
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => close(d === 'RELEASE')}>{d === 'RELEASE' ? 'Confirm payment' : 'Done'}</button>
        </div>
      </Shell>
    );
  }

  // ---- consent ----
  if (check.status === 'idle') {
    return (
      <Shell>
        <h2>A quick safety check</h2>
        <p>
          This payment of <strong>{gbp(transfer.amountGBP)}</strong> to <strong>{transfer.payee.name}</strong> looks unusual, so we'd like to ask a couple of
          questions before it goes.
        </p>
        <p className="muted">
          It uses your microphone and speaker. Audio from your device is analysed during the check to help protect you. Why we're asking:
        </p>
        <ul className="muted">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => void check.start()}>Start voice check</button>
          <button className="btn btn-ghost" onClick={() => close(false)}>Cancel payment</button>
        </div>
      </Shell>
    );
  }

  // ---- live ----
  return (
    <Shell>
      <h2>Safety check in progress</h2>
      <div className="status">
        <span className={`dot ${check.status}`} />
        {check.status === 'connecting' && 'Connecting to the safety assistant…'}
        {check.status === 'live' && 'Listening — just talk naturally. You can interrupt at any time.'}
        {check.status === 'reconnecting' && 'Connection dropped — reconnecting…'}
        {check.status === 'ended' && 'Call ended.'}
      </div>
      <div className="transcript" aria-live="polite">
        {check.transcript.map((line, i) => (
          <div key={i} className={`bubble ${line.role}`}>
            <small>{line.role === 'agent' ? 'Larkmoor assistant' : 'You'}</small>
            {line.text}
          </div>
        ))}
        <div ref={transcriptEnd} />
      </div>
      <div className="actions">
        <button className="btn btn-ghost" onClick={() => check.requestHuman()}>I'd rather speak to a person</button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="modal">{children}</div>
    </div>
  );
}
