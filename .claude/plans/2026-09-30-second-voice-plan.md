# Second Voice — Implementation Plan

**Overall Progress:** `78%` (25 / 32 steps done · Phases 1–5 done, Phase 6 partly · Phase 0 gate proceeded past by Adwik's decision: only 3 counted trials + observations; range/latency/gateway checks still open)

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
- **Audio: ONE shared mic stream (AEC on, NS/AGC off) feeding both connections** — supersedes the dual-stream split: Chrome granted AEC off to a second, differently-constrained stream (spike run 3; probe confirmed AEC-on/NS-off/AGC-off is granted when opened alone). Agent stream keeps `voice_focus: far-field`; room stream = Realtime STT `speaker_labels`. No GPU service.
- **Detection = content + echo, not source separation (approved reframe 2026-09-30).** Spike runs showed loudness and speaker labels cannot separate a phone at ~1.5 m from the customer or the agent's leaked voice, and the agent stream itself hears a loud phone voice. Core signals: LLM content cues on either stream + echo (customer repeats coach). Room-only speech, diarization and loudness are supporting/tie-breakers. **Whispers out of scope** (quiet clips 0% transcribed). Pitch: "hears the coach on speakerphone".
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
  - [x] 🟩 Generate test clips (3 coaching, 1 benign × normal/quiet) — `scripts/make-spike-clips.ps1`, served at `/spike-clips/index.html`
  - [x] 🟩 Switch spike to one shared mic stream (AEC on, NS/AGC off); constraint probe added — Chrome grants all 8 combinations when opened alone
  - [ ] 🟨 **Range test (replaces the 1.5 m trials — 1.5 m failed in run 5; coach speech captured only with the phone near the laptop):** 30 / 60 / 100 cm × phone volume 50% / 100%, ~5 plays each; gate ≥ 7 of 10 visible at ~60 cm. (original wording follows) 10 trials: phone plays a coach clip at normal volume ~1.5 m while the victim answers the agent out loud (+ a few clips while the agent talks) → press ✔/✘ for "coach speech visible to the detector" (room-only words OR in the agent transcript)
  - [x] 🟩 Confirmed the agent's own voice is absent from the room stream with AEC on (run 4: zero leaked words)
  - [ ] 🟥 Confirm the agent's own TTS is not flagged as background; benign clip not flagged as coaching
  - [x] 🟩 ~~managed vs Gateway latency~~ — moot: the Gateway's Claude models are not accessible on this (Free) account; the agent stays on the managed model. Measured: **managed measured: avg 1,745 ms (n = 6, steady state 1.3–1.8 s); gateway still to measure**
- [ ] 🟥 **Step 5: Go/no-go** (record in wiki `decisions.md`)
  - [ ] 🟥 ≥ 7 of 10 trials visible → proceed as reframed (content + echo core)
  - [ ] 🟥 < 7 of 10 → pivot to content + echo on the agent-stream transcript only; pitch "detects coached answers"
  - [ ] 🟥 If Chrome rejects dual constraints → single raw stream + Web Audio noise gate on the agent path

### Phase 1 — Core Logic (pure functions + tests) 🟩 Done (2026-09-30)
> `[DELEGATING → Codex /execute]` → `[DELEGATING → Codex /run-code]` → `[DELEGATING → Codex /review]`

- [x] 🟩 **Step 6: Loudness Tagger (tie-breaker only)** — `src/core/loudness.ts`: `wordDbfs`, `median`, `tagProximity`, `tagWords(words, rmsFrames, customerMedianDbfs)`; `far` if ≥ 6 dB below the customer median (no `sessionStartMs` needed: word timings already share the frame clock)
- [x] 🟩 **Step 7: Signal Engine** — `src/core/text-match.ts`, `src/core/signal-engine.ts`
  - [x] 🟩 Fuzzy, digit-aware word matcher + stopword-aware content overlap (`text-match.ts`)
  - [x] 🟩 `classifyRoomWords()` / `findRoomOnlySpeech()` — fuzzy + digit-aware matching, customer-speech window attribution (`input.speech.started/stopped`), agent-echo subtraction; evidence rule per spec §7.5
  - [x] 🟩 `detectEcho()` — overlap coefficient ≥ 0.5 and ≥ 2 shared content words, 2–10 s after the coach utterance; plus `coachingEvidence()` rule
- [x] 🟩 **Step 8: Risk Scorer** (`src/core/risk-scorer.ts`) — points table, bands (<30 / 30–69 / ≥70), hard triggers, tool-failure +10
- [x] 🟩 **Step 9: Precheck rule** (`src/core/precheck.ts`) — ≥ £1,000 and (new payee or CoP ≠ MATCH), or ≥ 3× the 90-day max
- [x] 🟩 Unit tests for every function above, including all bands and hard triggers — 108 tests passing; mutation-checked (4 deliberate breaks each failed the matching test)

### Phase 2 — Serverless API + Mock Bank 🟩 Done (2026-09-30)
> `[DELEGATING → Codex /execute]` → `[DELEGATING → Codex /run-code]` → `[DELEGATING → Codex /review]`

- [x] 🟩 **Step 10: Mock bank data + endpoints** — `api/_lib/bank-data.ts` + `bank.ts`; `GET /api/bank/profile|payee-check|payee-risk`; personas tuned so the £8,000 demo payment HOLDS on bank signals alone (60) and the coach tips it to ESCALATE
- [x] 🟩 **Step 11: `POST /api/detect`** — **rules-first** (`src/core/coaching-rules.ts`: instant, offline, injection-proof; 16/16 visible, 8/10 held-out, 0 false alarms) with an **opt-in LLM second opinion** (`DETECT_MODEL`; structured or unstructured mode). Pivot forced by the account: Free tier → gateway has no usable rate limit and only `qwen3.5-4b-32k-fast` is accessible
- [x] 🟩 **Step 12: Agent setup script** — `scripts/agent-config.ts` + `scripts/create-agent.mjs` (create / `--update <id>`); live agent `agent_be6f8fc68a1544f49d7f04b83eb88d10`: 6 client tools, `voice` AND `output.voice` = anna (a live read-back caught `output.voice` defaulting to "ivy"), far-field, keyterms; managed LLM; turn detection left on default per AssemblyAI docs
- [x] 🟩 Endpoint tests for all `api/*` (mock gateway incl. timeout / 429 / malformed; live-verified `POST /api/detect` and bank routes) — 234 tests passing

### Phase 3 — Bank App + Voice Check Agent 🟩 Done (2026-09-30) — verified live in headless Chrome
> `[DELEGATING → Codex /execute]` → `[DELEGATING → Codex /run-code]` → `[DELEGATING → Codex /review]`

- [x] 🟩 **Step 13: Bank App Shell** — `src/app/` (BankApp, VoiceCheckModal, tested `transfer.ts` flow, 4 one-click demo scenarios, `?scenario=S4` prefill); fail-safe: bank unreachable → nothing sent; CoP failure → unverified → still gets the check
- [x] 🟩 **Step 14: Voice Check Client** — `src/voice/agent-client.ts` (AgentSession) + `voice-check.ts` (controller); `/api/token/agent` now also returns the agent id
- [x] 🟩 **Step 15: Client-side tools** (`src/voice/tools.ts`) — `get_customer_profile`, `check_payee`, `get_payee_risk`, `record_answer`, `decide_payment` (returns the scorer's decision), `request_human`; `is_error` path
- [x] 🟩 **Step 16: Agent Injector** (`src/voice/injector.ts`) — trusted `system`-role context + coaching note; max 1 proactive per 20 s; non-accusatory. Live: "Is there someone there with you right now? … the bank will never ask you to keep a payment a secret or to lie to us."
- [x] 🟩 **Step 17: Error handling** per spec §9 — one `session.resume` reconnect with a fresh token, then fail-safe hold; mic denied / no token / resume failure → hold; connect timeout

### Phase 4 — Room Listener + Signal Pipeline + Fraud Officer Panel 🟩 Done (2026-09-30) — verified live
> `[DELEGATING → Codex /execute]` → `[DELEGATING → Codex /run-code]` → `[DELEGATING → Codex /review]`

- [x] 🟩 **Step 18: Room Listener** (`src/voice/room-listener.ts`) — shared mic → Realtime STT (speaker labels, per-word dBFS from the 50 ms RMS frames); fails soft to `unavailable`. Live: connected, diarization separated customer (A) from coach (B)
- [x] 🟩 **Step 19: Pipeline wiring** (`VoiceCheck`) — both streams → Signal Engine (settle delay, room-only runs, stopword bridging) → detector → scorer → injector; same-audio de-duplication across streams; room-heard coaches feed echo. (No separate debounce needed: each run is judged once.)
- [x] 🟩 **Step 20: Fraud Officer Panel** (`src/app/OfficerPanel.tsx`, tested `officer-signals.ts`) — dual transcripts, highlighted background utterances, speaker/loudness strip, signal chips, risk gauge + reasons, decision
- [x] 🟩 **Step 21: Audit Record export** (`src/voice/audit.ts`) — JSON + printable HTML; no audio stored, account masked, all spoken text HTML-escaped
- [x] 🟩 Removed the Phase 0 `/spike` page and its agent script (git history keeps them)

### Phase 5 — Scammer Simulator 🟩 Done (2026-09-30)
> `[DELEGATING → Codex /execute]` → `[DELEGATING → Codex /run-code]` → `[DELEGATING → Codex /review]` · clip generation: Claude-managed

- [x] 🟩 **Step 22: TTS provider** — **decision changed:** the phone speaks the lines live with the browser's built-in speech synthesis (Web Speech API). No audio files, no third-party licence question (Windows SAPI output has unclear redistribution terms), no accounts, works offline, no assets to host
- [x] 🟩 **Step 23: Script** — 8 coaching lines (feeding answers / secrecy / rushing / posing as the bank) + 3 benign, in `src/simulator/lines.ts`; a test asserts the detector catches every coaching line at ≥ 0.7 and none of the benign ones
- [x] 🟩 **Step 24: `/simulator` page** — mobile-first (verified at a real 390 px emulated viewport), one tap per line, "Play a coached call" (3 lines, 9 s apart), voice/speed/volume controls, Stop

### Phase 6 — Scenario Evaluation + Tuning 🟨 Partly done — automated live runs complete; manual real-voice/phone runs are Adwik's
> Claude-managed with Adwik (manual runs) · any tuning code changes → `/execute` → `/run-code` → `/review`

- [ ] 🟨 **Step 25: Scenario runs** — automated, in headless Chrome against the live Voice Agent API with a synthetic customer + coach (table in wiki `scenario-results.md`): **S4 coached scam: 7 live runs → ESCALATE every time (coaching caught in all; echo checked and caught in the 3 runs after the window was widened to 30 s; the earlier runs escalated on points alone)**; **S2 honest plumber: 2 runs → RELEASE (20 → 10 after fixing a false positive)**. S1 (no check) is covered by unit tests, S3 by the scoring tests. **Still to do by Adwik: real voice + real phone runs** (the synthetic coach is a clean voice on the same stream)
- [x] 🟩 **Step 26: Tune** — no threshold tuning needed (loudness/diarization are tie-breakers only). Tuning that WAS needed, all found by live runs: echo window 10 → 30 s; stopwords bridge room-only runs; negation-aware cue analysis and no mining of the agent's paraphrase (honest customer was flagged for secrecy)
- [x] 🟩 **Step 27: Agent prompt** — observed live across 7 runs: ≤ 2 short sentences per turn, one question at a time, asks the gentle second-voice question in the agent's own voice, reads the outcome kindly; no repeated-question problem after the first runs. No change needed

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
