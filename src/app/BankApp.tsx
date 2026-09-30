/**
 * Larkmoor Bank — the fictional bank app the Voice Check lives in (Plan Step 13).
 * Account overview + payment form. A payment that needs no check is "sent"; one that does opens the Voice Check.
 */
import { useState } from 'react';
import { VoiceCheck } from '../voice/voice-check';
import { SCENARIOS } from './scenarios';
import OfficerPanel from './OfficerPanel';
import { EMPTY_FORM, evaluateTransfer, type TransferForm } from './transfer';
import VoiceCheckModal from './VoiceCheckModal';
import './app.css';

const gbp = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

declare global {
  interface Window {
    /** Dev builds only: the active VoiceCheck, for end-to-end drivers and debugging. */
    __voiceCheck?: VoiceCheck;
  }
}

interface Banner {
  tone: 'ok' | 'warn' | 'bad';
  text: string;
}

export default function BankApp() {
  const [form, setForm] = useState<TransferForm>(() => {
    // ?scenario=S4 pre-fills the form — handy for demos and screenshots.
    const id = new URLSearchParams(window.location.search).get('scenario');
    return SCENARIOS.find((s) => s.id === id)?.form ?? EMPTY_FORM;
  });
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [active, setActive] = useState<{ check: VoiceCheck; reasons: string[] } | null>(null);
  // The officer panel outlives the customer's modal, so the audit record stays reachable after "Done".
  const [watching, setWatching] = useState<VoiceCheck | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const set = (key: keyof TransferForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    setBusy(true);
    const outcome = await evaluateTransfer(form);
    setBusy(false);

    switch (outcome.kind) {
      case 'invalid':
        return setBanner({ tone: 'bad', text: outcome.error });
      case 'error':
        return setBanner({ tone: 'bad', text: outcome.message });
      case 'sent':
        setBanner({ tone: 'ok', text: `${gbp(outcome.transfer.amountGBP)} sent to ${outcome.transfer.payee.name}.` });
        return setForm(EMPTY_FORM);
      case 'check': {
        const check = new VoiceCheck(outcome.transfer, { profile: outcome.profile, cop: outcome.cop });
        if (import.meta.env.DEV) window.__voiceCheck = check; // dev builds only — for end-to-end drivers
        setWatching(check);
        setPanelOpen(true);
        return setActive({ check, reasons: outcome.reasons });
      }
    }
  }

  function finish(proceed: boolean) {
    if (!active) return;
    const { transfer, state } = active.check;
    const held = state.decision?.decision;
    if (proceed) {
      setBanner({ tone: 'ok', text: `${gbp(transfer.amountGBP)} sent to ${transfer.payee.name}.` });
      setForm(EMPTY_FORM);
    } else if (held === 'COOLING_OFF' || held === 'ESCALATE') {
      setBanner({ tone: 'warn', text: `Your payment of ${gbp(transfer.amountGBP)} to ${transfer.payee.name} is on hold while a colleague reviews it with you.` });
      setForm(EMPTY_FORM);
    } else {
      setBanner({ tone: 'warn', text: 'Payment cancelled. Nothing has left your account.' });
    }
    setActive(null);
  }

  return (
    <div className={watching && panelOpen ? 'with-panel' : undefined}>
      <header className="bank-header">
        <div className="brand">Lark<span>moor</span> Bank</div>
        <div className="user">
          {watching && !panelOpen && <button className="btn btn-ghost" style={{ color: '#fff', borderColor: '#ffffff55', padding: '4px 10px', marginRight: 12 }} onClick={() => setPanelOpen(true)}>Officer view</button>}
          Sarah Mitchell · Personal account
        </div>
      </header>

      <main className="bank-main">
        <section className="card">
          <h2>Current account</h2>
          <div className="muted">20-99-01 · 55512345</div>
          <div className="balance">{gbp(12_480.55)}</div>
          <div className="muted">Available balance</div>
          <h2 style={{ marginTop: 20 }}>Your payees</h2>
          <ul className="payees">
            <li><span>Priya Shah</span><span className="muted">20-45-11 · 4011 2233</span></li>
          </ul>
          <p className="muted" style={{ marginBottom: 0 }}>All people, banks and accounts in this demo are fictional.</p>
        </section>

        <section className="card">
          <h2>Make a payment</h2>
          <div className="scenarios" aria-label="Demo scenarios">
            {SCENARIOS.map((s) => (
              <button key={s.id} type="button" onClick={() => setForm(s.form)} title={s.id}>{s.label}</button>
            ))}
          </div>
          {banner && <div className={`banner ${banner.tone}`} role="status">{banner.text}</div>}
          <form onSubmit={submit} className="form-grid" noValidate>
            <label className="field wide">Payee name<input value={form.payeeName} onChange={set('payeeName')} autoComplete="off" /></label>
            <label className="field">Sort code<input value={form.sortCode} onChange={set('sortCode')} inputMode="numeric" placeholder="00-00-00" autoComplete="off" /></label>
            <label className="field">Account number<input value={form.accountNumber} onChange={set('accountNumber')} inputMode="numeric" placeholder="8 digits" autoComplete="off" /></label>
            <label className="field">Amount (£)<input value={form.amount} onChange={set('amount')} inputMode="decimal" autoComplete="off" /></label>
            <label className="field">Reference<input value={form.reference} onChange={set('reference')} autoComplete="off" /></label>
            <div className="wide"><button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Send payment'}</button></div>
          </form>
        </section>
      </main>

      {active && <VoiceCheckModal check={active.check} reasons={active.reasons} onClose={({ proceed }) => finish(proceed)} />}
      {watching && panelOpen && <OfficerPanel check={watching} onHide={() => setPanelOpen(false)} />}
    </div>
  );
}
