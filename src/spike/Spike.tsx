/**
 * /spike — Phase 0 de-risking page (throwaway; removed in Phase 4).
 * Runs the dual-stream session and shows the evidence we need for the go/no-go decision.
 */
import { useMemo, useRef, useState } from 'react';
import { SpikeSession, type AgentLine, type RoomTurn } from './session';
import { openMic } from './audio';
import { speakerLoudness, unmatchedWords } from './metrics';
import './spike.css';

type AgentKind = 'managed' | 'gateway';
const STORE_KEY = 'sv.spike.agents';
/** A room-stream word counts as "heard by the agent" if a customer transcript landed within this window. */
const MATCH_WINDOW_MS = 8000;
/** The agent's own reply text arrives after it finishes speaking, and replies run long — wider window. */
const AGENT_WINDOW_MS = 15000;
/** Provisional near/far threshold from the spec; the trials tell us whether it is right. */
const FAR_GAP_DB = 6;

function loadAgents(): Record<AgentKind, string> {
  try {
    return { managed: '', gateway: '', ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') };
  } catch {
    return { managed: '', gateway: '' };
  }
}

const fmtDb = (n: number | null) => (n === null ? '—' : n.toFixed(0));
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export default function Spike() {
  const [agents, setAgents] = useState(loadAgents);
  const [kind, setKind] = useState<AgentKind>('managed');
  const [running, setRunning] = useState(false);
  const [shared, setShared] = useState(true);
  const [ranShared, setRanShared] = useState(true);
  const [agc, setAgc] = useState(false);
  const [ranAgc, setRanAgc] = useState(false);
  const [status, setStatus] = useState('Idle.');
  const [error, setError] = useState('');
  const [constraints, setConstraints] = useState<{ a: MediaTrackSettings; b: MediaTrackSettings } | null>(null);
  const [roomTurns, setRoomTurns] = useState<RoomTurn[]>([]);
  const [roomPartial, setRoomPartial] = useState('');
  const [agentLines, setAgentLines] = useState<AgentLine[]>([]);
  const [latencies, setLatencies] = useState<Record<AgentKind, number[]>>({ managed: [], gateway: [] });
  const [trials, setTrials] = useState({ hit: 0, miss: 0, ttsLeak: 0, benignFlagged: 0 });
  const [probe, setProbe] = useState<{ asked: string; got: string }[]>([]);
  const session = useRef<SpikeSession | null>(null);

  /**
   * Asks Chrome for every echo-cancel / noise-suppress / auto-gain combination and records what it
   * actually grants. Run 3 showed Mic B asked for echoCancellation:true but received false — this
   * finds out which combinations (if any) give AEC with NS and AGC off.
   */
  async function probeConstraints() {
    const rows: { asked: string; got: string }[] = [];
    for (const aec of [true, false])
      for (const ns of [true, false])
        for (const agc of [true, false]) {
          // Newer Chrome typings allow string modes (e.g. "remote-only") as well as booleans.
          const onOff = (v: boolean | string | undefined) =>
            v === undefined ? '?' : v === true || (typeof v === 'string' && v !== 'none') ? 'on' : 'off';
          const label = (a: boolean | string | undefined, n: boolean | string | undefined, g: boolean | string | undefined) =>
            `AEC ${onOff(a)} · NS ${onOff(n)} · AGC ${onOff(g)}`;
          try {
            const stream = await openMic({ echoCancellation: aec, noiseSuppression: ns, autoGainControl: agc });
            const g = stream.getAudioTracks()[0].getSettings();
            stream.getTracks().forEach((t) => t.stop());
            rows.push({ asked: label(aec, ns, agc), got: label(g.echoCancellation, g.noiseSuppression, g.autoGainControl) });
          } catch (e) {
            rows.push({ asked: label(aec, ns, agc), got: `error: ${e instanceof Error ? e.message : String(e)}` });
          }
        }
    setProbe(rows);
  }

  const setAgentId = (k: AgentKind, id: string) => {
    const next = { ...agents, [k]: id.trim() };
    setAgents(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — ids just won't persist */
    }
  };

  async function start() {
    setError('');
    setRoomTurns([]);
    setAgentLines([]);
    setRoomPartial('');
    setRanShared(shared);
    setRanAgc(agc);
    const s = new SpikeSession(agents[kind], { sharedMic: shared, agc }, {
      status: setStatus,
      constraints: (a, b) => setConstraints({ a, b }),
      roomPartial: setRoomPartial,
      roomTurn: (t) => setRoomTurns((prev) => [...prev, t]),
      agentLine: (l) => setAgentLines((prev) => [...prev, l]),
      latency: (ms) => setLatencies((prev) => ({ ...prev, [kind]: [...prev[kind], ms] })),
      error: setError,
    });
    session.current = s;
    setRunning(true);
    try {
      await s.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await stop();
    }
  }

  async function stop() {
    await session.current?.stop();
    session.current = null;
    setRunning(false);
  }

  // Classify each room word against the two things we already know were said near it:
  //   customer transcript → matched (plain)   |   the agent's own reply → "leak" (purple)
  //   neither             → "missing" (orange) = background-speech candidate
  const turnsView = useMemo(
    () =>
      roomTurns.map((t) => {
        const near = (role: AgentLine['role'], windowMs: number) =>
          agentLines.filter((l) => l.role === role && Math.abs(l.at - t.at) <= windowMs).map((l) => l.text);
        const words = t.words.map((w) => w.text);
        const notCustomer = unmatchedWords(words, near('customer', MATCH_WINDOW_MS));
        const missing = new Set(unmatchedWords(notCustomer, near('agent', AGENT_WINDOW_MS)).map((w) => w.toLowerCase()));
        const leak = new Set(notCustomer.map((w) => w.toLowerCase()).filter((w) => !missing.has(w)));
        return { turn: t, missing, leak };
      }),
    [roomTurns, agentLines],
  );

  const loudness = useMemo(() => speakerLoudness(roomTurns.flatMap((t) => t.words)), [roomTurns]);

  // Shared mode: did Chrome grant AEC on + NS off + AGC off? Two-stream mode: did the two streams differ as asked?
  const honoured = constraints
    ? ranShared
      ? constraints.b.echoCancellation === true && constraints.b.noiseSuppression === false && constraints.b.autoGainControl === ranAgc
      : constraints.b.noiseSuppression === false && constraints.a.noiseSuppression !== false
    : null;

  const results = () =>
    JSON.stringify(
      {
        sharedMic: ranShared,
        agcRequested: ranAgc,
        constraintsAsRequested: honoured,
        micA: constraints?.a,
        micB: constraints?.b,
        constraintProbe: probe,
        speakerLoudness: loudness,
        farGapThresholdDb: FAR_GAP_DB,
        trials,
        whisperHitRate: trials.hit + trials.miss ? trials.hit / (trials.hit + trials.miss) : null,
        latencyMsAvg: { managed: avg(latencies.managed), gateway: avg(latencies.gateway) },
        latencySamples: latencies,
      },
      null,
      2,
    );

  return (
    <main className="spike">
      <h1>Phase 0 spike — dual-stream second-voice test</h1>
      <p className="muted">
        Headphones OFF (laptop speakers). Phone ~1.5 m away plays a coach clip at normal volume WHILE you answer the agent out
        loud (also try a few clips while the agent is talking). Go = coach speech visible to the detector in ≥ 7 of 10 trials.
        Whispers are out of scope (run 3: 0% detected).
      </p>

      <section className="row">
        {(['managed', 'gateway'] as const).map((k) => (
          <label key={k}>
            <input type="radio" checked={kind === k} disabled={running} onChange={() => setKind(k)} /> {k} agent id{' '}
            <input
              value={agents[k]}
              disabled={running}
              onChange={(e) => setAgentId(k, e.target.value)}
              placeholder="run: node scripts/spike-agents.mjs"
            />
          </label>
        ))}
        {running ? (
          <button onClick={stop}>Stop</button>
        ) : (
          <button onClick={start} disabled={!agents[kind]}>
            Start
          </button>
        )}
        <label>
          <input type="checkbox" checked={shared} disabled={running} onChange={(e) => setShared(e.target.checked)} /> one shared
          mic (AEC on, NS off)
        </label>
        <label>
          <input type="checkbox" checked={agc} disabled={running} onChange={(e) => setAgc(e.target.checked)} /> auto gain (AGC)
          on — may extend range
        </label>
        <span>{status}</span>
      </section>
      {error && <p className="error">{error}</p>}

      <section>
        <h2>
          1 · {ranShared ? `Did Chrome grant AEC on + NS off + AGC ${ranAgc ? 'on' : 'off'}?` : 'Did Chrome honour different constraints?'}{' '}
          {honoured === null ? '' : honoured ? '✅ yes' : '❌ no'}
        </h2>
        {constraints && (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>echoCancellation</th>
                <th>noiseSuppression</th>
                <th>autoGainControl</th>
              </tr>
            </thead>
            <tbody>
              {(['a', 'b'] as const).map((k) => (
                <tr key={k}>
                  <td>Mic {k.toUpperCase()}</td>
                  <td>{String(constraints[k].echoCancellation)}</td>
                  <td>{String(constraints[k].noiseSuppression)}</td>
                  <td>{String(constraints[k].autoGainControl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="cols">
        <section>
          <h2>
            2 · Room stream (speaker · dBFS per word ·{' '}
            <span className="missing">orange = neither you nor the agent said it</span> ·{' '}
            <span className="leak">purple = agent's own voice leaking in</span>)
          </h2>
          {turnsView.map(({ turn, missing, leak }, i) => (
            <p key={i} className="turn">
              <b>[{turn.speaker}]</b>{' '}
              {turn.words.map((w, j) => (
                <span
                  key={j}
                  className={
                    missing.has(w.text.toLowerCase()) ? 'missing' : leak.has(w.text.toLowerCase()) ? 'leak' : ''
                  }
                  title={`speaker ${w.speaker}, ${fmtDb(w.dbfs)} dBFS`}
                >
                  {w.text}
                  <sub>
                    {w.speaker}·{fmtDb(w.dbfs)}
                  </sub>{' '}
                </span>
              ))}
            </p>
          ))}
          {roomPartial && <p className="muted">… {roomPartial}</p>}
        </section>

        <section>
          <h2>3 · Agent stream (what the agent heard / said)</h2>
          {agentLines.map((l, i) => (
            <p key={i} className={l.role}>
              <b>{l.role}:</b> {l.text}
            </p>
          ))}
        </section>
      </div>

      <section>
        <h2>4 · Loudness per speaker label (far = ≥ {FAR_GAP_DB} dB below loudest)</h2>
        <table>
          <thead>
            <tr>
              <th>label</th>
              <th>words</th>
              <th>median dBFS</th>
              <th>gap to loudest</th>
              <th>verdict</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(loudness).map(([label, l]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{l.words}</td>
                <td>{l.medianDbfs.toFixed(1)}</td>
                <td>{l.gapDb.toFixed(1)} dB</td>
                <td>{l.gapDb >= FAR_GAP_DB ? 'FAR (background)' : 'near'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>5 · Trials — press after each coach clip</h2>
        <div className="row">
          <button onClick={() => setTrials((t) => ({ ...t, hit: t.hit + 1 }))}>
            ✔ coach speech visible (orange in room stream, or in the agent transcript)
          </button>
          <button onClick={() => setTrials((t) => ({ ...t, miss: t.miss + 1 }))}>✘ not visible anywhere</button>
          <button onClick={() => setTrials((t) => ({ ...t, ttsLeak: t.ttsLeak + 1 }))}>
            agent voice leaked into room stream
          </button>
          <button onClick={() => setTrials((t) => ({ ...t, benignFlagged: t.benignFlagged + 1 }))}>
            benign chatter looked like coaching
          </button>
          <button onClick={() => setTrials({ hit: 0, miss: 0, ttsLeak: 0, benignFlagged: 0 })}>reset</button>
        </div>
        <p>
          hit {trials.hit} · miss {trials.miss} · rate{' '}
          <b>{trials.hit + trials.miss ? Math.round((100 * trials.hit) / (trials.hit + trials.miss)) + '%' : '—'}</b> ·
          TTS leaks {trials.ttsLeak} · benign flagged {trials.benignFlagged}
        </p>
      </section>

      <section>
        <h2>6 · Agent reply latency (customer stops → first reply audio)</h2>
        <p>
          managed: <b>{avg(latencies.managed) ?? '—'} ms</b> (n={latencies.managed.length}) · gateway:{' '}
          <b>{avg(latencies.gateway) ?? '—'} ms</b> (n={latencies.gateway.length})
        </p>
      </section>

      <section>
        <h2>7 · Mic constraint probe (what Chrome really grants)</h2>
        <button onClick={() => void probeConstraints()} disabled={running}>Probe 8 combinations</button>
        {probe.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>asked for</th>
                <th>granted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {probe.map((r) => (
                <tr key={r.asked}>
                  <td>{r.asked}</td>
                  <td>{r.got}</td>
                  <td>{r.asked === r.got ? '' : '⚠ differs'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <button onClick={() => void navigator.clipboard.writeText(results())}>Copy results JSON</button>
    </main>
  );
}
