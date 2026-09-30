/**
 * Evaluates coaching detection on the labelled cases in api/_lib/detect-cases.ts:
 *   1. the rules baseline (offline, instant) on the visible AND held-out sets — always runs
 *   2. optionally the LLM second opinion against the real LLM Gateway, per model
 *
 * Usage:
 *   node scripts/eval-detect.mjs                                   rules baseline only
 *   node scripts/eval-detect.mjs [--unstructured] model [model…]   + LLM (reads ASSEMBLYAI_API_KEY from .env.local)
 * --unstructured: for models that reject response_format (e.g. qwen3.5-4b-32k-fast).
 *
 * NOTE: the gateway rate-limits per model (Free: none usable; Paid: 30 requests/min), so LLM runs are paced.
 * Node runs the TypeScript imports directly (built-in type stripping); those files have no relative imports.
 */
import { classifyByRules } from '../src/core/coaching-rules.ts';
import { CASES, HELD_OUT } from '../api/_lib/detect-cases.ts';
import { classify } from '../api/_lib/detect.ts';

const MIN_CONFIDENCE = 0.7; // the risk scorer only acts at or above this
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ---- 1. rules baseline
function rulesReport(label, cases) {
  const rows = cases.map((c) => ({ c, v: classifyByRules([c.text]) }));
  const flagged = (r) => r.v !== null && r.v.confidence >= MIN_CONFIDENCE;
  const wrong = rows.filter((r) => flagged(r) !== r.c.expect);
  const fp = wrong.filter((r) => !r.c.expect).length;
  console.log(`rules · ${label}: correct ${rows.length - wrong.length}/${rows.length} · false alarms ${fp} · misses ${wrong.length - fp}`);
  for (const r of wrong) console.log(`   ✗ ${r.c.name}: expected ${r.c.expect ? 'COACHING' : 'benign'}, got ${r.v ? `${r.v.type} @ ${r.v.confidence}` : 'nothing'}`);
}
console.log('=== rules baseline (offline)');
rulesReport('visible cases (seen while writing the rules)', CASES);
rulesReport('HELD-OUT cases (written after the rules)', HELD_OUT);

// ---- 2. optional LLM second opinion
const args = process.argv.slice(2);
const unstructured = args.includes('--unstructured');
const models = args.filter((a) => !a.startsWith('--'));
if (models.length === 0) process.exit(0);

try {
  process.loadEnvFile('.env.local');
} catch {
  /* fall back to an exported ASSEMBLYAI_API_KEY */
}
const apiKey = process.env.ASSEMBLYAI_API_KEY;
if (!apiKey) {
  console.error('ASSEMBLYAI_API_KEY is not set (copy .env.example to .env.local).');
  process.exit(1);
}

const transfer = { amountGBP: 8000, payeeName: 'Northgate Autos Ltd', purpose: 'car' };
const recentConversation = [{ role: 'agent', text: "What's this payment for?" }];
const all = [...CASES, ...HELD_OUT];

for (const model of models) {
  console.log(`\n=== LLM · ${model}${unstructured ? ' (unstructured)' : ''}`);
  const rows = [];
  for (const c of all) {
    const started = performance.now();
    const r = await classify({ utterances: [{ source: c.source, text: c.text }], recentConversation, transfer }, apiKey, {
      model,
      timeoutMs: 20_000,
      structured: !unstructured,
    });
    rows.push({ c, r, ms: Math.round(performance.now() - started) });
    await new Promise((res) => setTimeout(res, 2200)); // ~27 requests/min, under the paid limit of 30
  }
  const degraded = rows.filter((x) => x.r.degraded).length;
  const judged = rows.filter((x) => !x.r.degraded);
  const wrong = judged.filter((x) => (x.r.isCoaching && x.r.confidence >= MIN_CONFIDENCE) !== x.c.expect);
  console.log(
    `judged ${judged.length}/${rows.length} (degraded ${degraded}) · correct ${judged.length - wrong.length} · false alarms ${wrong.filter((x) => !x.c.expect).length} · misses ${wrong.filter((x) => x.c.expect).length} · median ${median(rows.map((x) => x.ms))} ms`,
  );
  for (const x of wrong) console.log(`   ✗ ${x.c.name}: expected ${x.c.expect ? 'COACHING' : 'benign'}, got ${x.r.type} @ ${x.r.confidence}`);
}
