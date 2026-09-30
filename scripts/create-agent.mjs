/**
 * Creates or updates the Second Voice stored agent on the Voice Agent API (Plan Step 12).
 *
 *   node scripts/create-agent.mjs                 create a new agent, print its id
 *   node scripts/create-agent.mjs --update <id>   replace an existing agent's configuration (PUT)
 *
 * Reads ASSEMBLYAI_API_KEY from .env.local. Prints the id and the exact `AGENT_ID=` line to add to .env.local —
 * it never edits that file (it holds your key). The configuration lives in scripts/agent-config.ts.
 */
import { agentConfig } from './agent-config.ts';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* fall back to an exported ASSEMBLYAI_API_KEY */
}
const apiKey = process.env.ASSEMBLYAI_API_KEY;
if (!apiKey) {
  console.error('ASSEMBLYAI_API_KEY is not set. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

const args = process.argv.slice(2);
const updateIdx = args.indexOf('--update');
const updateId = updateIdx === -1 ? null : args[updateIdx + 1];
if (updateIdx !== -1 && !updateId) {
  console.error('--update needs an agent id.');
  process.exit(1);
}

const url = updateId ? `https://agents.assemblyai.com/v1/agents/${updateId}` : 'https://agents.assemblyai.com/v1/agents';
const res = await fetch(url, {
  method: updateId ? 'PUT' : 'POST',
  headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify(agentConfig),
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status} ${text}`);
  process.exit(1);
}

const { id } = JSON.parse(text);
console.log(`${updateId ? 'Updated' : 'Created'} agent: ${id}`);
console.log(`Add this line to .env.local:  AGENT_ID=${id}`);
