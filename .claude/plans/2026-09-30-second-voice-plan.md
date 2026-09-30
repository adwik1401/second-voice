# Second Voice — Implementation Plan

**Overall Progress:** `9%` (3 / 32 steps done · Phase 0 in progress: Step 3 running live; Step 4 whisper trials + latency comparison remaining)

**Spec:** [`.claude/specs/2026-09-30-second-voice-design.md`](../specs/2026-09-30-second-voice-design.md) · **Repo:** https://github.com/adwik1401/second-voice

## TLDR
Build **Second Voice**: a scam-interrupt voice agent for a fictional UK bank (Larkmoor Bank). A risky transfer opens an in-app Voice Check. The agent (AssemblyAI Voice Agent API) questions the customer and calls mock bank tools. A parallel room stream (Realtime STT + diarization), plus loudness tagging and a comparison of the two transcripts, detects a second voice coaching the customer. The LLM Gateway classifies the coaching. A deterministic risk scorer releases the payment, applies a cooling-off hold, or escalates to a human, and writes an audit record. Phase 0 proves the second-voice detection works before anything else is built.

## Delegation Pipeline
Each code phase follows:
```
/execute (Codex) → /run-code → /fix-bug (if failures) → /review
```
- Before each `/execute`: TodoWrite entry + `[DELEGATING → Codex /execute]` announcement
- After each delegation: append a row to `.claude/agent-log.md` (create with header on first use)
- Quality gate for every code phase: `npm run lint` + `npm run typecheck` + `npm run test` pass
- **End of every phase:** update `changelog.md` + wiki `log.md` → commit → `git push origin main`
- **Never delegate:** secrets/env setup, deploys (Claude-managed)

## Critical Decisions
- **Audio: dual-stream mic split (Approach A)** — agent stream (echo cancellation + `voice_focus: far-field`), room stream (browser noise suppression/AGC off → Realtime STT `speaker_labels`). Keeps AssemblyAI central; no GPU service.
- **Background detection = 3 signals voting** (transcript diff, diarization, loudness) **+ echo detection**. Robust if diarization alone is weak.
- **Deterministic risk scorer decides; the LLM only supplies signals.** Auditable. Never a flat refusal; fail-safe is a hold, not a release.
- **Signal injection via `conversation.message` + `reply.create`.** Verified in the Voice Agent API events reference.
- **Stack:** Vite + React + TS SPA, Vitest, ESLint; **Vercel** serverless `api/` functions (resolves spec open item 1: simplest single-repo SPA + functions); mock bank data as JSON; no DB.
- **UK framing, voice `anna`, bank = Larkmoor Bank.** Solo build; AI-voice Scammer Simulator for tests and the demo.
- **All AssemblyAI:** Voice Agent API + Realtime STT + LLM Gateway.

## Tasks

### Phase 0 — Scaffold + De-risking Spike 🔴 go/no-go gate 🟨 In Progress
> Scaffold: `[DELEGATING → Codex /execute]` → `/run-code` → `/review` · Env + trials: **Claude-managed with Adwik** (needs a live mic and a phone)

- [x] 🟩 **Step 1: Scaffold repo**
  - [x] 🟩 Vite + React + TS app; ESLint; Vitest; scripts `dev`, `build`, `lint`, `typecheck`, `test`
  - [x] 🟩 `api/` folder for Vercel functions (web-standard `GET(request)` handlers; Vite dev middleware serves them locally, no Vercel CLI needed); `.env.example` (`ASSEMBLYAI_API_KEY`)
- [x] 🟩 **Step 2: Token endpoints (Claude-managed secrets)** — unit-tested and live-verified 2026-09-30 (both return HTTP 200)
  - [x] 🟩 `GET /api/token/agent` → AAI `GET /v1/token` (Bearer auth; 120 s redemption, 600 s session cap)
  - [x] 🟩 STT browser token endpoint verified in docs (`GET streaming.assemblyai.com/v3/token`, raw-key auth) → `GET /api/token/stt`
  - [x] 🟩 Live-verified both endpoints return a token with the real key
- [x] 🟩 **Step 3: Spike page (`/spike`, throwaway)** — built, typechecked, linted, first live run passed
  - [x] 🟩 Mic A + Mic B with different constraints; page reports whether Chrome honoured both (`getSettings()`)
  - [x] 🟩 Room stream → Realtime STT `speaker_labels: true`, `max_speakers: 3` (`universal-3-6-pro`)
  - [x] 🟩 Agent stream → Voice Agent session via stored `agent_id`; replies played with barge-in flush
  - [x] 🟩 50 ms RMS frames on Mic B → per-word dBFS + per-speaker loudness table (near/far at 6 dB gap)
  - [x] 🟩 `scripts/spike-agents.mjs` creates the managed + LLM-Gateway agents for the latency comparison
  - [x] 🟩 First live run: both sockets connect, transcripts appear, agent speaks (2026-09-30; findings in wiki `spike-results.md`)
- [ ] 🟨 **Step 4: Trials (Adwik + phone)**
  - [x] 🟩 Spike now subtracts the agent's own words from the "background" highlight (run 1 showed agent TTS leaking into the room stream)
  - [ ] 🟥 Generate 3 test clips (2 coaching, 1 benign) with any TTS for the spike
  - [ ] 🟥 10 whisper trials at ~1.5 m → record background identification rate
  - [ ] 🟥 Confirm the agent's own TTS is not flagged as background; benign clip not flagged as coaching
  - [ ] 🟥 Measure agent reply latency: managed model vs LLM Gateway (Claude) → pick one
- [ ] 🟥 **Step 5: Go/no-go** (record in wiki `decisions.md`)
  - [ ] 🟥 ≥ 70% → proceed as specced
  - [ ] 🟥 < 70% → fall back to transcript-diff + echo only; reframe the feature as "detects coached answers"
  - [ ] 🟥 If Chrome rejects dual constraints → single raw stream + Web Audio noise gate on the agent path

### Phase 1 — Core Logic (pure functions + tests)
> `[DELEGATING → Codex /execute]` → `[DELEGATING → Codex /run-code]` → `[DELEGATING → Codex /review]`

- [ ] 🟥 **Step 6: Loudness Tagger** — `tagWords(words, rmsFrames, sessionStartMs)`; primary = loudest median; `far` if ≥ 6 dB below (constant from spike)
- [ ] 🟥 **Step 7: Signal Engine**
  - [ ] 🟥 Fuzzy transcript matcher (±1.5 s window)
  - [ ] 🟥 `findBackground()` — 2-of-3 vote, or diff alone with ≥ 4 unmatched words
  - [ ] 🟥 `detectEcho()` — token overlap ≥ 0.5 within 10 s
- [ ] 🟥 **Step 8: Risk Scorer** — points table, bands (<30 / 30–69 / ≥70), hard triggers, tool-failure +10
- [ ] 🟥 **Step 9: Precheck rule** — ≥ £1,000 and (new payee or CoP ≠ MATCH), or ≥ 3× the 90-day max
- [ ] 🟥 Unit tests for every function above, including all bands and hard triggers

### Phase 2 — Serverless API + Mock Bank
> `[DELEGATING → Codex /execute]` → `[DELEGATING → Codex /run-code]` → `[DELEGATING → Codex /review]`

- [ ] 🟥 **Step 10: Mock bank data + endpoints** — customers, payees (legit / scam personas), `GET /api/bank/profile|payee-check|payee-risk`
- [ ] 🟥 **Step 11: `POST /api/detect`** — LLM Gateway, JSON schema per spec §7.6, temperature 0, 3 s timeout → `unclear`
- [ ] 🟥 **Step 12: Agent setup script** — creates/updates the stored agent (system prompt §7.10, greeting, voice `anna`, `voice_focus`, transcription prompt, keyterms, chosen LLM)
- [ ] 🟥 Endpoint tests for all `api/*` (mock AAI + Gateway, incl. timeout path)

### Phase 3 — Bank App + Voice Check Agent
> `[DELEGATING → Codex /execute]` → `[DELEGATING → Codex /run-code]` → `[DELEGATING → Codex /review]`

- [ ] 🟥 **Step 13: Bank App Shell** — Larkmoor account overview, payees, transfer form → precheck → Voice Check modal
- [ ] 🟥 **Step 14: Voice Check Client** — token → WS → `session.update` with `agent_id`; audio in/out; interruption flush; transcript events
- [ ] 🟥 **Step 15: Client-side tools** — `get_customer_profile`, `check_payee`, `get_payee_risk`, `record_answer`, `decide_payment` (returns the scorer's decision), `request_human`; `is_error` path
- [ ] 🟥 **Step 16: Agent Injector** — `inject(note, speakNow)`; max 1 per 20 s; non-accusatory instructions
- [ ] 🟥 **Step 17: Error handling** per spec §9 (reconnect once → COOLING_OFF; mic denied → human review)

### Phase 4 — Room Listener + Signal Pipeline + Fraud Officer Panel
> `[DELEGATING → Codex /execute]` → `[DELEGATING → Codex /run-code]` → `[DELEGATING → Codex /review]`

- [ ] 🟥 **Step 18: Room Listener** — Mic B stream → Realtime STT; RMS frame capture; degraded mode if unavailable
- [ ] 🟥 **Step 19: Pipeline wiring** — room turns + agent transcripts → Signal Engine → `/api/detect` (debounced, 1 in-flight) → Risk Scorer → Injector
- [ ] 🟥 **Step 20: Fraud Officer Panel** — dual transcripts, highlighted background utterances, speaker/loudness strip, signal chips, risk gauge + reasons, decision
- [ ] 🟥 **Step 21: Audit Record export** — JSON + printable HTML (spec §7.11); no audio stored
- [ ] 🟥 Remove the Phase 0 `/spike` page

### Phase 5 — Scammer Simulator
> `[DELEGATING → Codex /execute]` → `[DELEGATING → Codex /run-code]` → `[DELEGATING → Codex /review]` · clip generation: Claude-managed

- [ ] 🟥 **Step 22: Choose TTS provider** — licence check for demo/public use (spec open item 2); log in wiki
- [ ] 🟥 **Step 23: Generate clips** — ~10 coaching lines × (whisper, normal) + 3 benign; static MP3s in `public/`
- [ ] 🟥 **Step 24: `/simulator` page** — mobile-first button grid, one tap = play

### Phase 6 — Scenario Evaluation + Tuning
> Claude-managed with Adwik (manual runs) · any tuning code changes → `/execute` → `/run-code` → `/review`

- [ ] 🟥 **Step 25: Run S1–S5 × 5** (spec §11) → record results table in wiki
- [ ] 🟥 **Step 26: Tune** thresholds (dB gap, overlap, confidence) until S4/S5 ≥ 4/5 and S2 raises no coaching flag
- [ ] 🟥 **Step 27: Agent prompt polish** — ≤ 2 sentences per turn, tone, correct decision wording

### Phase 7 — Deploy / Quality Gate
> Claude-managed (no sub-agent delegation)

- [ ] 🟥 Vercel project + env vars (`ASSEMBLYAI_API_KEY`) — set by Claude/Adwik, never committed
- [ ] 🟥 Preview deploy + smoke test (Playwright or manual: S1 + S4 on the live URL, simulator on phone)
- [ ] 🟥 Production deploy + repeat smoke test
- [ ] 🟥 Update README (setup, architecture, AAI products used, demo links) + `changelog.md`

### Phase 8 — Submission Package
> Claude-managed with Adwik

- [ ] 🟥 **Step 28:** Verify slide stats against primary sources (UK Finance £576.4m; PSR £85k / Oct 2024); drop or source the US $20bn figure
- [ ] 🟥 **Step 29:** Slide deck (problem → demo → architecture → business case → AAI usage)
- [ ] 🟥 **Step 30:** 3-min video per spec §5 script (record against the production URL)
- [ ] 🟥 **Step 31:** Cover image; short + long descriptions; tags
- [ ] 🟥 **Step 32:** lablab submission form — repo URL, app URL, video, slides — then final wiki update
