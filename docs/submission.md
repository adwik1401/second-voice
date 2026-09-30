# Submission pack — Second Voice

Deadline: **30 Sep 2026, 8:30 PM IST.** Assets in this repo: `docs/images/cover.png` (cover image), `docs/Second-Voice-deck.pptx` (10 slides), this file.

## lablab form

**Project title:** Second Voice

**Short description** (one line):
A scam-interrupt voice agent for UK banks: it hears the coach feeding a payment victim their answers, and escalates before the money moves.

**Long description:**
In authorised push payment scams the victim makes the payment themselves, often while a scammer stays on the phone and coaches them through the bank's checks: "tell her it's for a car deposit, don't mention me." UK banks reported £576.4m lost to these scams in 2025 (UK Finance), and since 7 October 2024 the sending bank must reimburse eligible victims, up to £85,000 a claim, so the loss now lands on the bank.

Second Voice is a short Voice Check that opens in the banking app when a payment looks risky. An AssemblyAI Voice Agent talks to the customer, asks what the payment is for, and runs the bank's checks (Confirmation of Payee, recipient-account risk, the customer's history) as tools. Meanwhile a second AssemblyAI stream, Realtime Speech-to-Text with speaker labels, listens to the whole room from the same microphone. The system detects coaching language (scripting answers, secrecy, rushing, posing as the bank) and the customer repeating the coach's words. When it hears a coach, the agent gently asks: "Is there someone there with you right now? The bank will never ask you to keep a payment a secret or to lie to us."

A transparent, deterministic points table (never the LLM) decides: release, pause for 24 hours, or escalate to a fraud specialist. There is never a flat refusal, every hold offers a human, and a fraud officer watches the same call live with an itemised "why this score" and an exportable audit record. It fails safe (mic denied or connection lost means a hold, never a release), stores no audio, and an honest customer is approved after a short conversation.

It was tested end to end in headless Chrome against the live AssemblyAI APIs (coached scam: escalated in 7 of 7 runs; honest customer: released in 2 of 2), with 447 automated tests. Limitations are stated plainly: it hears coaching at conversational volume within arm's reach of the laptop, not whispers across a room.

**Technology tags:** AssemblyAI Voice Agent API · Realtime Speech-to-Text API · (React, TypeScript, Vite, Vercel)
**Category:** Fintech · Fraud prevention · Voice AI

**Links:** GitHub https://github.com/adwik1401/second-voice · Demo app: `<your Vercel URL>` · Video: `<upload link>` (files: `docs/video/second-voice-demo.mp4`, 85 s, and `docs/video/second-voice-teaser.mp4`, 23 s) · Slides: `docs/Second-Voice-deck.pptx`

## Demo video

**Ready to upload:** `docs/video/second-voice-demo.mp4` (85 s, 1080p). It is a real recorded run (headless Chrome against the live AssemblyAI Voice Agent API, agent voice is the real agent audio) with Kokoro narration, made with HyperFrames; the customer and scammer voices are synthetic and the video says so on screen. `docs/video/second-voice-teaser.mp4` (23 s, `/brag --voice`) is a short social cut. Upload one of them to YouTube (unlisted) and paste the link above.

### Optional: record your own version (about 3 minutes)

Setup: laptop with speakers (no headphones) in a quiet room, Chrome at `<your URL>` (or `http://localhost:5173`); phone open at `<your URL>/simulator`, volume about 70%, **on the table next to the laptop**. Screen-record at 1440×900 or larger. You are the customer; speak naturally.

| Time | On screen | Say / do |
|---|---|---|
| 0:00–0:20 | Cover, then slide 2 | "In the UK, £576 million was lost last year to scams where the victim makes the payment themselves — often with a scammer on the phone, coaching them through the bank's questions. Second Voice hears the coach." |
| 0:20–0:50 | App: click **£1,200 to a plumber**, Send, Start voice check | Customer lines: "It's for a new boiler, a plumber my neighbour recommended." "Yes, I've used him before." "No, nobody's pressuring me." Result: **Payment approved**, officer score 10. "An honest customer isn't interrogated: a short chat and it's released." |
| 0:50–2:15 | Click **£8,000 to a car dealer**, Send, Start | Say: "It's for a deposit on a car." Show the officer panel: bank signals alone = **60, a hold**. Then on the phone tap **Play a coached call**. Point at the panel: **coaching detected**, score **85+**. The agent asks the gentle question aloud. Answer: "No… it's for a car deposit." Panel: **customer repeated the coach's words**, **100**, hard trigger. Customer sees **A specialist will call you**. |
| 2:15–2:40 | Officer panel → **Download audit record** / **Print view** | "Every point is explained line by line, for the fraud team and the regulator. No audio is stored." |
| 2:40–3:00 | Slide 6 or 8 | "Built on AssemblyAI's Voice Agent API and Realtime Speech-to-Text. 447 tests, and live end-to-end runs. The limits are stated: conversational volume, within arm's reach. Scammers coach their victims — Second Voice hears the coach." |

Tips: do two takes; if the agent's reply is slow, cut in the edit. Keep the officer panel visible throughout. If the phone voice is too quiet, raise the phone volume, not the laptop's. The rules catch every line on the simulator, so the demo is repeatable.

## Deploy (Netlify) — about 5 minutes

1. Log in to your **personal** Netlify account in the browser (not the QCIN work account), then app.netlify.com → Add new site → Import an existing project → GitHub → `adwik1401/second-voice`. Build settings are read from `netlify.toml`.
2. Site configuration → Environment variables: `ASSEMBLYAI_API_KEY` (your key) and `AGENT_ID` (the line in your `.env.local`). Leave `DETECT_MODEL` unset (rules only — the most reliable for a demo). Then Deploys → Trigger deploy.
3. Send Claude the URL, or run the smoke test yourself (replace the URL):
   ```bash
   curl -s https://YOUR-URL/api/token/agent            # expect {"token":"…","agentId":"agent_…"}
   curl -s "https://YOUR-URL/api/bank/payee-check?sortCode=99-12-34&accountNumber=71829035&name=Northgate%20Autos%20Ltd"   # {"result":"NO_MATCH",…}
   curl -s -X POST https://YOUR-URL/api/detect -H 'content-type: application/json' \
     -d '{"utterances":[{"source":"room_stream","text":"Tell her it is for a car deposit. Do not mention me."}],"recentConversation":[],"transfer":{"amountGBP":8000,"payeeName":"X"}}'   # isCoaching true
   ```
4. Open the URL, allow the microphone, run the £8,000 scenario once. Open `/simulator` on your phone.

## Before you submit

- [ ] Repo is public and has the MIT licence (it does); README renders with the screenshot
- [ ] Demo URL works on a fresh browser, microphone prompt appears, scenario S4 escalates
- [ ] Video uploaded (YouTube unlisted is fine) and plays
- [ ] Cover image uploaded (`docs/images/cover.png`), slides uploaded (export the .pptx to PDF if the form wants PDF)
- [ ] Long description pasted; tags set; category set
- [ ] Submitted with a buffer — aim to press Submit by **7:30 PM IST**
