# Changelog

## 2026-09-30
- Repo initialised: design spec, README, MIT license, .gitignore.
- Phase 0 (partial): scaffold (Vite + React + TS, ESLint, Vitest); token endpoints `/api/token/agent|stt` with dev middleware + tests; `/spike` dual-stream test page (Mic A → Voice Agent API, Mic B → Realtime STT with speaker labels + per-word loudness); `scripts/spike-agents.mjs`.
- Spike: agent-echo words shown purple; clip generator script + phone clip page for whisper trials; spec §7.5 gains fuzzy matching, customer-speech window attribution, median loudness.
- Reframe (approved): detection = content cues + echo; whispers out of scope. Spec §1, §7.3-7.6, §11, §12 and plan updated. Spike now uses ONE shared mic stream (AEC on, NS/AGC off) after the constraint probe showed Chrome grants it; trial buttons relabelled for coach-while-customer-speaks trials.
- Spike: finalised room turns with no per-word data now fall back to the turn transcript instead of rendering blank; run 4 confirmed the shared mic removes the agent-voice leak.
- Spike: AGC toggle for range testing; latency samples under 200 ms discarded as glitches.
- Phase 1: `src/core/` — loudness tie-breaker helpers, fuzzy digit-aware text matching, Signal Engine (word classification, room-only speech, echo, evidence rule), precheck rule, risk scorer; 93 new tests.
- Phase 2: mock bank API (`/api/bank/*`) with demo personas; `POST /api/detect` — rules-first coaching detector (`src/core/coaching-rules.ts`) with an opt-in LLM second opinion; `scripts/create-agent.mjs` + `scripts/agent-config.ts` (6 client tools, voice pinned); coaching floor in the risk scorer; 126 new tests (234 total).
- Phase 3: Larkmoor bank app + Voice Check modal (`src/app/`), voice layer (`src/voice/`: agent session with resume/tool-ordering, controller, tools, injector, check state, answer analysis, detect client), `/api/token/agent` returns the agent id, echo window widened to 30 s; 75 new tests (371 total); verified live in headless Chrome.
- Phase 4: Fraud Officer Panel (live score, signals, itemised reasons, evidence, transcripts) + audit record export; RoomListener (Realtime STT, speaker labels, per-word loudness) and two-stream evidence pipeline with de-duplication; `/spike` removed; stopwords bridge room-only runs; 45 new tests (416 total).
- Phase 5: `/simulator` — phone-side scammer that speaks coaching lines live (browser speech synthesis); script tested against the detector; spike clip assets removed; 17 new tests (433 total).
- Fix: cue analysis is negation-aware and record_answer's paraphrase is no longer mined (an honest customer was being flagged for secrecy); live scenario runs S4 x5 ESCALATE, S2 x2 RELEASE; 14 new tests (447 total).
- Submission pack (`docs/`): cover, 10-slide deck, form text, video script, deploy guide; README cites UK Finance + PSR; functions import with explicit `.js` extensions for Vercel's strict ESM runtime (verified under plain Node ESM with a negative control).
- Netlify deployment support: `netlify.toml` and one `/api/*` function dispatching to the shared handlers (8 new tests; 455 total). Vercel config kept.
- Demo video: 85 s HyperFrames cut of a real recorded run with Kokoro narration (`docs/video/second-voice-demo.mp4`) and a 23 s `/brag --voice` teaser (`docs/video/second-voice-teaser.mp4`); compositions in `videos/demo/` and `brag-output/`.
