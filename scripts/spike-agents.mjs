/**
 * Phase 0 helper: creates the two stored Voice Agent API agents the /spike page compares.
 *   managed  — AssemblyAI's built-in conversational model (the default)
 *   gateway  — Claude via AssemblyAI's LLM Gateway (billed on AssemblyAI credits)
 * Both share the same prompt, UK voice and far-field noise suppression, so latency is the only variable.
 *
 * Usage:  node scripts/spike-agents.mjs        (reads ASSEMBLYAI_API_KEY from .env.local)
 * Prints the two agent ids — paste them into the /spike page.
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  /* fall back to an already-exported ASSEMBLYAI_API_KEY */
}

const apiKey = process.env.ASSEMBLYAI_API_KEY;
if (!apiKey) {
  console.error('ASSEMBLYAI_API_KEY is not set. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

/** Gateway model from AssemblyAI's "connect your own LLM" docs example. */
const GATEWAY_MODEL = 'claude-sonnet-4-6';

const base = {
  system_prompt:
    "You are Larkmoor Bank's payment safety assistant. Ask the customer, in at most two short sentences per turn, " +
    'what their payment is for and who it is going to. Stay calm, warm and British. Never accuse the customer of anything.',
  greeting: "Hi, I'm Larkmoor's payment safety assistant. What's this payment for?",
  voice: { voice_id: 'anna' },
  input: { voice_focus: 'far-field' },
};

const variants = {
  managed: { name: 'Second Voice spike — managed', ...base },
  gateway: {
    name: 'Second Voice spike — gateway',
    ...base,
    llm: [{ base_url: 'https://llm-gateway.assemblyai.com/v1', model: GATEWAY_MODEL, api_key: apiKey }],
  },
};

for (const [label, body] of Object.entries(variants)) {
  const res = await fetch('https://agents.assemblyai.com/v1/agents', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`${label}: HTTP ${res.status} ${await res.text()}`);
    process.exitCode = 1;
    continue;
  }
  const { id } = await res.json();
  console.log(`${label.padEnd(8)} agent id: ${id}`);
}
