# Second Voice — Design Spec

**Date:** 2026-09-30
**Author:** Adwik (solo) · design facilitated by Claude
**Competition:** AssemblyAI × lablab.ai Voice Agent Hackathon — see `.claude/wiki/` for rules, judging, landscape
**Status:** Draft — awaiting Adwik's review

---

## 1. Summary

**Second Voice** is a scam-interrupt voice agent for UK banks. When a customer initiates a high-risk bank transfer, the bank app opens a short in-app **Voice Check**. A conversational agent talks to the customer, calls bank tools (Confirmation of Payee, payee risk, customer profile), and decides to **release**, **hold with a cooling-off period**, or **escalate to a human fraud officer** — writing an auditable intervention record.

Its signature capability: a **parallel room-listening stream** detects a *second voice* coaching the customer (e.g. a scammer on speakerphone whispering "say it's for a car"), and the agent reacts to it in real time.

**One-line pitch:** *"Scammers coach their victims through the bank's questions. Second Voice hears the coach."*

## 2. Problem & why now

- UK authorised push payment (APP) fraud losses: **£576.4m in 2025, +19% YoY** — highest since 2021.
- Since **Oct 2024**, UK payment service providers must reimburse APP victims up to **£85,000** per claim, split between sending and receiving firms → scam losses now hit bank P&L directly.
- Scammers increasingly **coach victims live** (often via speakerphone, increasingly with AI voices and LLM scripts) to give the "right" answers to bank intervention questions, defeating scripted checks.
- Today's interventions are scripted in-app warnings (clicked through) or costly human calls (also coachable).

## 3. Goals & non-goals

**Goals**
1. A working, deployed web demo: fictional UK bank app → Voice Check → decision → audit record.
2. Detect second-voice coaching live from a single laptop mic, and have the agent respond naturally.
3. Use AssemblyAI deeply: Voice Agent API + Realtime STT (diarization) + LLM Gateway.
4. A 3-minute video that any judge understands in the first 20 seconds.

**Non-goals (YAGNI)**
- No real bank integration, no auth, no database, no real PII.
- No outbound calls (Voice Agent API SIP is inbound-only), no phone channel in v1.
- No voice biometrics / deepfake detection.
- No languages other than English output (Voice Agent API TTS limit).
- No mobile-native app; browser only (desktop Chrome is the supported demo target).

## 4. Judging-criteria mapping

| Criterion | How Second Voice scores |
|---|---|
| Application of Technology | Three AAI products in concert: Voice Agent API (turn-taking, interruptions, JSON-schema tools, `voice_focus`, `reply.create` / `conversation.message` injection), Realtime STT with `speaker_labels` on a separate stream, LLM Gateway for coaching detection. Dual-stream transcript differencing is a non-obvious use of `voice_focus`. |
| Presentation | Dramatic, universally-understood scenario; live Fraud Officer panel visualises what the AI hears; repeatable via Scammer Simulator. |
| Business Value | Direct P&L line for UK banks (mandatory reimbursement); reduces human intervention-call cost; auditable records support Consumer Duty / PSR expectations. |
| Originality | No submission does bank-side, payment-time, conversational intervention with coaching detection (nearest: Guard Line, ScamTrap — both victim-side). |

## 5. Demo narrative (target video script, ~3 min)

1. **Hook (0:00–0:20):** stat + "scammers coach victims through bank checks".
2. **Legit payment (0:20–0:50):** Adwik sends £400 to a known payee → no Voice Check, or a 15-second check → **Released**. Shows it's not friction-for-everyone.
3. **Coached scam (0:50–2:10):** Adwik sends £8,000 to a new payee "for a car". Voice Check opens. Phone (Scammer Simulator) whispers coaching lines. Panel lights up: background speaker detected → coaching quote → customer echoes the coached phrase. Agent gently: *"I might be wrong, but it sounds like someone else is with you — is anyone telling you what to say?"* CoP shows payee is a personal account, not a dealership; account 6 days old. Agent → **Escalate** with cooling-off; human handoff offered.
4. **Audit record (2:10–2:30):** downloadable intervention record with evidence.
5. **Tech + business close (2:30–3:00):** architecture slide, AAI products used, reimbursement economics.

## 6. Architecture

**Stack:** Vite + React + TypeScript SPA; serverless functions (Vercel or Netlify — pick at plan time, same code shape); mock bank data as static JSON. No database. All secrets server-side via env vars with `.env.example`.

```
Victim laptop (Chrome)                                   Serverless functions
┌──────────────────────────────────────────────────┐    ┌────────────────────────────┐
│ Bank App Shell ── risky transfer ──► Voice Check │    │ GET  /api/token/agent      │
│                                                  │◄──►│ GET  /api/token/stt        │
│ Mic A (echoCancellation ON, NS/AGC default)      │    │ POST /api/detect  ─► LLM   │
│   └─► Agent stream ──WS──► AAI Voice Agent API   │    │                     Gateway│
│          voice: anna · voice_focus: far-field    │    │ GET  /api/bank/*  (mock)   │
│          tools ◄──► Mock Bank Services           │    └────────────────────────────┘
│ Mic B (echoCancellation ON, NS OFF, AGC OFF)     │
│   └─► Room stream ──WS──► AAI Realtime STT       │
│          speaker_labels: true, max_speakers: 3   │
│   └─► Loudness Tagger (Web Audio RMS frames)     │
│                    ▼                              │
│ Signal Engine: transcript diff + loudness +       │
│   speaker labels → background utterances          │
│                    ▼                              │
│ Coaching Detector (calls /api/detect)             │
│                    ▼                              │
│ Risk Scorer ──► Agent Injector                    │
│   (conversation.message + reply.create)           │
│ Fraud Officer Panel · Audit Record export         │
└──────────────────────────────────────────────────┘
Phone: Scammer Simulator page (pre-generated AI-voice clips)
```

## 7. Components (each: purpose · interface · depends on)

### 7.1 Bank App Shell
- **Purpose:** fictional UK bank UI ("Larkmoor Bank" — fictional; name checked 2026-09-30, no bank/fintech uses it. "Harbourline" rejected: collides with HarborLine fintech and Harbourline finance app). Account overview, payees, transfer form.
- **Interface:** emits `TransferIntent { amountGBP, payeeId | newPayee{name, sortCode, accountNumber}, reference, purpose? }`. Calls `precheck(intent) → { requiresVoiceCheck: boolean, reasons: string[] }`.
- **Voice Check trigger rule:** amount ≥ £1,000 **and** (new payee **or** CoP result ≠ `MATCH`), or amount ≥ 3× customer's 90-day max outgoing.
- **Depends on:** Mock Bank Services.

### 7.2 Voice Check Client (agent stream)
- **Purpose:** own the Voice Agent API WebSocket session.
- **Interface:** `start(intent, customerId)`, `stop()`, events `onUserTranscript`, `onAgentTranscript`, `onToolCall`, `onStateChange`. Method `inject(note: string, speakNow: boolean)` → sends `conversation.message` then optional `reply.create { instructions }`.
- **Config:** stored agent created once via REST; browser connects with single-use token from `/api/token/agent`. Voice `anna` (UK). `voice_focus: far-field` (laptop mic). `transcription_prompt`: scenario context ("UK bank fraud-check call about a bank transfer…"). `keyterms`: payee name, bank name, "Confirmation of Payee", "sort code".
- **LLM:** decided in spike — managed model vs LLM Gateway (`claude-sonnet-4-6` or current equivalent). Pick lower latency with acceptable instruction-following.
- **Depends on:** `/api/token/agent`, Mock Bank Services (tools).

### 7.3 Room Listener (room stream)
- **Purpose:** hear the whole room, including faint background voices.
- **Interface:** `start(mediaStream)`, events `onTurn { text, speakerLabel, speakerConfidence, words[{text,start,end,speaker}] }`.
- **Config:** Realtime STT `universal-3-6-pro` (or latest), `speaker_labels: true`, `max_speakers: 3`, `prompt` = same scenario context. Token from `/api/token/stt`.
- **Mic B constraints:** `{ echoCancellation: true, noiseSuppression: false, autoGainControl: false }` (keep AEC so the agent's own TTS isn't transcribed; disable NS/AGC so whispers survive).
- **Depends on:** `/api/token/stt`.

### 7.4 Loudness Tagger
- **Purpose:** label each room-stream word as near (customer) or far (background) using level.
- **Interface:** pure fn `tagWords(words, rmsFrames, sessionStartMs) → words[] with { dbfs, proximity: 'near'|'far'|'unknown' }`.
- **Algorithm:** 50 ms RMS frames from an `AnalyserNode` on Mic B, timestamped against the STT session start. Per word: mean dBFS over its [start,end]. Per speaker label: running median dBFS. The speaker label with the loudest median = primary (customer); a label whose median is ≥ 6 dB below primary = `far`. Threshold is a tunable constant validated in the spike.
- **Depends on:** nothing (pure).

### 7.5 Signal Engine
- **Purpose:** decide which room-stream speech is **background speech** — robust even if diarization is imperfect.
- **Three independent signals, combined:**
  1. **Transcript difference:** the agent stream (with `voice_focus`) should transcribe only the customer. Room-stream words in a time window that have **no fuzzy match** in the agent-stream transcript of the same window (±1.5 s) are candidate background words.
  2. **Diarization:** words whose `speaker` ≠ primary speaker label.
  3. **Loudness:** words tagged `far`.
- **Agent-echo subtraction (added after first live spike run, 2026-09-30):** the agent's own voice plays through the laptop speakers and leaks into the room stream even with echo cancellation requested, where the room STT often mis-hears it (e.g. "Larkmoor's" → "Lark, the Morning King's"). Room words that match the agent's own `transcript.agent` text within ~15 s are classed as `agent_echo`, not background, before any voting. Fuzzy matching is required; pure timing suppression is rejected because a coach often whispers *while* the agent is speaking.
- **Diarization is a weak signal in short sessions:** in the first run one customer was labelled A, B and C and the agent's leaked voice A, B and C. Speaker labels are a tie-breaker only; loudness and the transcript difference carry the decision.
- **Rule:** a room-stream utterance is `background` if ≥ 2 of 3 signals agree, or signal 1 alone with ≥ 4 unmatched words.
- **Echo detection:** after a background utterance, if the customer's next agent-stream utterance within 10 s has high overlap with it (normalised token overlap ≥ 0.5, or LLM-judged paraphrase via `/api/detect`), emit `ECHO` — *the customer repeated what the coach said*. Strongest single signal.
- **Interface:** pure fns `findBackground(roomTurns, agentUserTurns, taggedWords) → BackgroundUtterance[]`, `detectEcho(bg, nextUserTurn) → EchoResult`.

### 7.6 Coaching Detector
- **Purpose:** classify background speech + conversation context.
- **Endpoint:** `POST /api/detect`
  - **Request:** `{ backgroundText: string, recentConversation: {role:'agent'|'customer', text}[], transfer: {amountGBP, payeeName, purpose} }`
  - **Response:** `{ isCoaching: boolean, type: 'script_feeding'|'secrecy_instruction'|'urgency_pressure'|'impersonation'|'benign_chatter'|'unclear', quote: string, confidence: 0..1, echoOf?: string }`
- **LLM:** LLM Gateway, JSON output, temperature 0; 3 s timeout → treat as `unclear`.
- **Debounce:** one call per background utterance, max 1 in-flight.

### 7.7 Risk Scorer
- **Purpose:** transparent, deterministic score and decision (LLM informs signals; code makes the call — auditable).
- **Interface:** pure fn `score(signals) → { score: 0..100, band, decision, reasons[] }`.

| Signal | Points |
|---|---|
| New payee | +10 |
| CoP `CLOSE_MATCH` / `NO_MATCH` | +10 / +20 |
| Payee account age < 30 days | +15 |
| Payee mule-risk score ≥ 0.7 | +20 |
| Amount ≥ 3× 90-day max | +10 |
| Stated purpose contradicts payee data (e.g. "car dealer" but personal account) — from agent tool `record_answer` | +15 |
| Urgency / secrecy / authority-impersonation cues in customer answers | +10 each (max +20) |
| Background speech detected | +10 |
| Coaching detected (confidence ≥ 0.7) | +25 |
| ECHO detected | +30 |
| Any bank tool failed (unverified) | +10 |

- **Decisions:** `RELEASE` (< 30) · `COOLING_OFF` 24 h hold (30–69) · `ESCALATE` to human fraud officer (≥ 70).
- **Hard triggers → ESCALATE regardless:** ECHO + coaching; customer says they were told to lie / move money to a "safe account" / contacted by "police" or "the bank".
- **Customer-protective invariant:** the agent never states a flat refusal. Every non-release offers a human and explains the hold; customer can always proceed via human review.

### 7.8 Agent Injector
- **Purpose:** feed room signals into the live conversation naturally.
- **Behaviour:** on coaching ≥ 0.7 → `conversation.message` (context note: "Room audio suggests a second person said: '<quote>'. Type: <type>.") then `reply.create` with instructions: *non-accusatory, one short question, e.g. ask if anyone is with them or telling them what to say; reassure that the bank never asks customers to lie.* Max one proactive injection per 20 s. Never read the quote verbatim unless asked.

### 7.9 Agent tools (client-side, JSON Schema)
| Tool | Purpose | Returns |
|---|---|---|
| `get_customer_profile` | tenure, typical payments, 90-day max | profile JSON |
| `check_payee` | Confirmation of Payee | `MATCH` / `CLOSE_MATCH{suggestedName}` / `NO_MATCH`, account type (personal/business) |
| `get_payee_risk` | account age, mule-risk score, prior reports | risk JSON |
| `record_answer` | log a structured answer (purpose, relationship, how contacted, pressure) | ack |
| `decide_payment` | agent's proposed decision + rationale | final decision from Risk Scorer (agent must speak the scorer's decision) |
| `request_human` | hand-off to fraud officer | ack + mock ETA |

### 7.10 Agent conversation design
- **System prompt outline:** role (Larkmoor fraud-prevention assistant), tone (calm, warm, British, brief — ≤ 2 sentences per turn), goal (understand the payment, protect the customer, never accuse), required flow, tool-use rules, the protective invariant, disclosure line at start ("This check uses audio from your device to help protect you").
- **Flow:** greet + disclosure → confirm amount/payee (tool: `check_payee`, `get_payee_risk`) → purpose → relationship/how met → how they were contacted about this payment → any pressure/urgency/secrecy → (injected second-voice question if triggered) → `decide_payment` → explain outcome → offer human.
- **Greeting (fixed):** "Hi, I'm Larkmoor's payment safety assistant. Before we send this £{amount}, I'd like to ask a couple of quick questions — it helps protect you from scams."

### 7.11 Fraud Officer Panel
- Live dual transcripts (agent stream vs room stream), background utterances highlighted, speaker/loudness timeline strip, signal chips (CoP, account age, coaching, ECHO), risk gauge with reasons, final decision.
- **Audit Record export:** JSON + printable HTML: timestamps, transfer details, tool results, signals with evidence quotes, score breakdown, decision, disclosure given. No audio stored.

### 7.12 Scammer Simulator
- Standalone page (phone). Buttons for ~10 coaching lines in whisper + normal variants; plus 3 "benign chatter" lines for false-positive testing.
- Clips **pre-generated** with an AI TTS tool and shipped as static MP3s (no runtime dependency). Provider picked at plan time (candidates: ElevenLabs, OpenAI TTS) — must allow commercial/demo use.

## 8. Data flow (coached-scam path)

1. Transfer submitted → `precheck` → Voice Check required.
2. Client fetches both tokens; opens Mic A and Mic B; opens both WebSockets; agent greets.
3. Customer answers → agent calls tools → Risk Scorer updates.
4. Simulator whispers → room stream transcribes → Signal Engine marks background → `/api/detect` → coaching 0.86 `script_feeding`.
5. Agent Injector → agent asks gently about a second person. Customer echoes coached phrase → ECHO.
6. Agent calls `decide_payment` → scorer returns `ESCALATE` → agent explains, offers human → Audit Record generated.

## 9. Error handling (fail-safe = hold, never release)

| Failure | Behaviour |
|---|---|
| Agent WS drops | One auto-reconnect; if it fails → `COOLING_OFF` + "a colleague will call you" |
| Room STT fails / unavailable | Continue agent-only; panel shows "room analysis unavailable"; no background signals scored |
| Mic B can't get separate constraints (Chrome limitation) | Single stream fallback: raw mic to room STT; Mic A path uses Web Audio noise gate before agent — decided in spike |
| `/api/detect` timeout/error | Treat as `unclear`, no points; log |
| Mic permission denied | Show message; route to human review (no release) |
| Token expired before connect | Refetch once |
| Tool error | `tool.result` with `is_error: true`; agent says it couldn't verify → +10 points (unverified) |

## 10. Security & compliance posture

- AssemblyAI key only in serverless env; browser uses single-use tokens (`expires_in_seconds` 60–300).
- No audio persisted; transcripts held in memory for the session; audit export is user-initiated.
- Explicit disclosure spoken at start that device audio is analysed.
- All data fictional. Repo MIT-licensed (competition requirement). `.env` gitignored, `.env.example` committed.

## 11. Testing & evaluation

**Unit (Vitest):** Loudness Tagger, Signal Engine (`findBackground`, `detectEcho`), Risk Scorer (all bands + hard triggers + invariant), precheck rule, transcript fuzzy matcher.
**Endpoint tests:** `/api/token/agent`, `/api/token/stt` (mock AAI), `/api/detect` (mock Gateway; schema + timeout path), `/api/bank/*`.
**Scenario evaluation (manual, repeatable via Simulator), 5 runs each:**
| Scenario | Expected |
|---|---|
| S1 Legit known payee, quiet room | RELEASE, no background flags |
| S2 Legit new payee (CoP MATCH, established account), friend chatting benignly in background | RELEASE (expected score ≈ 20: new payee +10, background speech +10), **no coaching flag** (false-positive test) |
| S3 Uncoached scam (bad CoP, new account, contradictory purpose) | COOLING_OFF/ESCALATE via bank signals only |
| S4 Coached scam, whisper at 1.5 m | ESCALATE; coaching detected ≥ 4/5 runs |
| S5 Coached scam, normal voice speakerphone | ESCALATE; ECHO detected ≥ 4/5 runs |

**Quality gates:** `npm run lint`, `npm run typecheck`, tests pass before any phase is complete.

## 12. Phase 0 — de-risking spike (must pass before building the rest)

A throwaway page proving the core bet:
- Two mic tracks with different constraints (or fallback confirmed).
- Room STT with `speaker_labels` + transcript diff vs agent stream (or plain STT stand-in) + loudness tags.
- Simulator clip whispered at ~1.5 m from a laptop.
- **Pass:** background utterance correctly identified in ≥ 70% of 10 trials; agent's own TTS not flagged as background; benign-chatter clip not classified as coaching.
- Also measure: agent reply latency managed vs LLM Gateway; confirm Realtime STT browser token endpoint.
- **If fail:** fall back to transcript-diff + echo signals only (still demoable), and reframe the feature as "detects coached answers" rather than "hears the second voice".

## 13. Submission deliverables

Public GitHub repo (MIT) · deployed app URL · Scammer Simulator URL · 3-min video · slide deck · cover image · short/long descriptions + tags (lablab form).

## 14. Open items (to resolve at plan time or in spike)

1. Deploy target: Vercel vs Netlify.
2. TTS provider for Simulator clips (licence check).
3. Agent LLM: managed vs LLM Gateway model (spike latency test).
4. Chrome behaviour for dual-constraint capture from one device (spike).
5. Realtime STT temporary-token endpoint for browser (verify in docs during spike).
6. ~~Bank name check~~ — resolved: **Larkmoor Bank**.
7. Git: folder is not yet a git repo — initialise before first commit; public repo required for submission.

## 15. References

- Wiki: `.claude/wiki/` — `challenge.md` (verified API capabilities), `languages.md`, `ideas.md` (pressure tests), `decisions.md`
- AssemblyAI docs: Voice Agent API (events reference, client-side tools, browser integration, voice_focus, connect your own LLM / LLM Gateway), Streaming diarization, Prompting & keyterms
- UK APP data: £576.4m 2025 (UK Finance via LBC); PSR mandatory reimbursement (Oct 2024, £85k cap)
