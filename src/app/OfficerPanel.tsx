/**
 * Fraud Officer Panel (Plan Step 20): what a bank's fraud team would watch — the live risk score and WHY, the
 * signals, the coaching evidence, and both transcripts — with a one-click audit export. The customer never sees
 * any of this. All derivation lives in tested modules (officer-signals, audit); this only renders them.
 */
import { useSyncExternalStore } from 'react';
import { buildAuditRecord, renderAuditHtml } from '../voice/audit';
import { OUTCOME_TITLE } from '../voice/outcome';
import type { VoiceCheck } from '../voice/voice-check';
import { openHtml, saveText } from './download';
import { gaugeBand, signalChips } from './officer-signals';

export default function OfficerPanel({ check, onHide }: { check: VoiceCheck; onHide: () => void }) {
  useSyncExternalStore(check.subscribe.bind(check), () => check.version);
  const s = check.state.snapshot();
  const shown = s.decision ?? s.risk;
  const band = gaugeBand(shown.score);
  const audit = () => buildAuditRecord({ reference: check.reference, snapshot: s, transcript: check.transcript, failureReason: check.failureReason });

  const flaggedAt = new Map(s.coachEvidence.map((e) => [e.at, e.source === 'echo' ? 'echo' : 'coach'] as const));

  return (
    <aside className="officer" aria-label="Fraud officer view">
      <div className="officer-head">
        <div>
          <div className="officer-title">Fraud officer view</div>
          <div className="officer-sub">Ref {check.reference} · {check.status}{check.failureReason ? ` · ${check.failureReason}` : ''}</div>
        </div>
        <button className="officer-x" onClick={onHide} aria-label="Hide officer view">✕</button>
      </div>

      <section>
        <div className="gauge-row">
          <span className={`score ${band}`}>{shown.score}</span>
          <span className="gauge-label">/ 100 · <strong className={band}>{s.decision ? OUTCOME_TITLE[s.decision.decision] : band === 'escalate' ? 'Would escalate' : band === 'hold' ? 'Would hold' : 'Would release'}</strong>{s.decision ? '' : ' (live)'}</span>
        </div>
        <div className="gauge" role="meter" aria-valuenow={shown.score} aria-valuemin={0} aria-valuemax={100}>
          <div className={`gauge-fill ${band}`} style={{ width: `${shown.score}%` }} />
          <span className="tick" style={{ left: '30%' }} />
          <span className="tick" style={{ left: '70%' }} />
        </div>
        <div className="gauge-scale"><span>release</span><span>hold 30</span><span>escalate 70</span></div>
        {shown.hardTrigger && <div className="hard">⚑ {shown.hardTrigger}</div>}
      </section>

      <section>
        <h3>Signals</h3>
        <div className="chips">{signalChips(s).map((c) => <span key={c.label} className={`chip ${c.tone}`}>{c.label}</span>)}</div>
      </section>

      <section>
        <h3>Why this score</h3>
        {shown.reasons.length === 0 ? <div className="quiet">No risk signals yet.</div> : (
          <ul className="reasons">{shown.reasons.map((r) => <li key={r.label}><span>{r.label}</span><b>+{r.points}</b></li>)}</ul>
        )}
      </section>

      {s.coachEvidence.length > 0 && (
        <section>
          <h3>Coaching evidence</h3>
          <ul className="evidence">
            {s.coachEvidence.map((e, i) => (
              <li key={i}><span className="src">{e.source}</span> {e.type.replace(/_/g, ' ')} — “{e.quote}” <b>{Math.round(e.confidence * 100)}%</b></li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>What the agent heard</h3>
        <div className="otrans">
          {check.transcript.length === 0 && <div className="quiet">Waiting for the conversation…</div>}
          {check.transcript.map((l, i) => (
            <div key={i} className={`oline ${l.role} ${l.role === 'customer' ? flaggedAt.get(l.at) ?? '' : ''}`}>
              <small>{l.role === 'agent' ? 'Agent' : 'Customer stream'}</small> {l.text}
            </div>
          ))}
        </div>
      </section>

      {check.roomStatus !== 'off' && (
        <section>
          <h3>What the room heard <span className="quiet">· {check.roomStatus}</span></h3>
          <div className="otrans">
            {check.roomLines.length === 0 && <div className="quiet">{check.roomStatus === 'unavailable' ? 'Room listening unavailable — the check continues on the agent stream.' : 'Listening…'}</div>}
            {check.roomLines.map((l, i) => (
              <div key={i} className={`oline room ${l.flagged ? 'coach' : ''}`}><small>{l.speaker}</small> {l.text}</div>
            ))}
          </div>
        </section>
      )}

      <section className="officer-actions">
        <button onClick={() => saveText(`audit-${check.reference}.json`, 'application/json', JSON.stringify(audit(), null, 2))}>Download audit record</button>
        <button onClick={() => openHtml(renderAuditHtml(audit()))}>Print view</button>
      </section>
      <div className="quiet foot">No audio is stored. Account numbers are masked in exports.</div>
    </aside>
  );
}
