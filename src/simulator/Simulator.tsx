/**
 * Scammer Simulator (Plan Step 24): open this on a PHONE and put it next to the laptop on speakerphone.
 * Tap a line and the phone speaks it in an AI voice — the "coach" feeding the customer answers. Nothing is
 * recorded or sent anywhere; the voice is the browser's built-in speech synthesis.
 */
import { useEffect, useRef, useState } from 'react';
import { COACHED_CALL, COACHED_CALL_GAP_MS, GROUP_LABEL, LINES, lineById, type LineGroup } from './lines';
import { listVoices, onVoicesChanged, pickVoice, speak, speechSupported, stopSpeaking } from './speech';
import './simulator.css';

const GROUPS: LineGroup[] = ['script', 'secrecy', 'urgency', 'authority', 'benign'];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function Simulator() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState('');
  const [rate, setRate] = useState(0.95);
  const [volume, setVolume] = useState(1);
  const [playing, setPlaying] = useState<string | null>(null);
  /** Bumped to cancel whatever is playing or scheduled (a tap, or Stop). */
  const run = useRef(0);

  useEffect(
    () =>
      onVoicesChanged(() => {
        const all = listVoices();
        setVoices(all);
        setVoiceURI((current) => current || pickVoice(all)?.voiceURI || '');
      }),
    [],
  );

  const opts = () => ({ voiceURI, rate, volume });

  async function playLine(id: string) {
    const line = lineById(id);
    if (!line) return;
    const mine = ++run.current;
    stopSpeaking();
    setPlaying(id);
    await speak(line.text, opts());
    if (run.current === mine) setPlaying(null);
  }

  async function playCall() {
    const mine = ++run.current;
    stopSpeaking();
    for (const id of COACHED_CALL) {
      if (run.current !== mine) return;
      setPlaying(id);
      await speak(lineById(id)!.text, opts());
      if (run.current !== mine) return;
      setPlaying(null);
      await sleep(COACHED_CALL_GAP_MS); // long enough for the customer and the agent to exchange a line
    }
  }

  function stop() {
    run.current++;
    stopSpeaking();
    setPlaying(null);
  }

  return (
    <main className="sim">
      <h1>Scammer simulator</h1>
      <p className="sim-note">
        Demo tool. Put this phone on speakerphone <strong>within arm's reach of the laptop</strong> and turn the phone volume up (about 70%). Nothing is
        recorded or sent anywhere.
      </p>
      {!speechSupported() && <p className="sim-warn">This browser has no speech synthesis — try Chrome or Safari on your phone.</p>}

      <button className="sim-call" onClick={() => void playCall()}>▶ Play a coached call</button>
      <button className="sim-stop" onClick={stop} disabled={playing === null}>■ Stop</button>

      {GROUPS.map((g) => (
        <section key={g} className={g === 'benign' ? 'sim-benign' : undefined}>
          <h2>{GROUP_LABEL[g]}</h2>
          {LINES.filter((l) => l.group === g).map((l) => (
            <button key={l.id} className={`sim-line ${playing === l.id ? 'on' : ''}`} onClick={() => void playLine(l.id)}>
              {playing === l.id ? '🔊 ' : ''}“{l.text}”
            </button>
          ))}
        </section>
      ))}

      <section className="sim-settings">
        <h2>Voice</h2>
        <label>
          Voice
          <select value={voiceURI} onChange={(e) => setVoiceURI(e.target.value)}>
            {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
          </select>
        </label>
        <label>
          Speed {rate.toFixed(2)}
          <input type="range" min="0.6" max="1.4" step="0.05" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </label>
        <label>
          Volume {Math.round(volume * 100)}%
          <input type="range" min="0.2" max="1" step="0.05" value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
        </label>
      </section>
    </main>
  );
}
