# Changelog

## 2026-09-30
- Repo initialised: design spec, README, MIT license, .gitignore.
- Phase 0 (partial): scaffold (Vite + React + TS, ESLint, Vitest); token endpoints `/api/token/agent|stt` with dev middleware + tests; `/spike` dual-stream test page (Mic A → Voice Agent API, Mic B → Realtime STT with speaker labels + per-word loudness); `scripts/spike-agents.mjs`.
- Spike: agent-echo words shown purple; clip generator script + phone clip page for whisper trials; spec §7.5 gains fuzzy matching, customer-speech window attribution, median loudness.
- Reframe (approved): detection = content cues + echo; whispers out of scope. Spec §1, §7.3-7.6, §11, §12 and plan updated. Spike now uses ONE shared mic stream (AEC on, NS/AGC off) after the constraint probe showed Chrome grants it; trial buttons relabelled for coach-while-customer-speaks trials.
