# Second Voice

**Scammers coach their victims through the bank's questions. Second Voice hears the coach.**

A scam-interrupt voice agent for UK banks, built on AssemblyAI for the AssemblyAI × lablab.ai Voice Agent Hackathon (Sep 2026).

When a customer starts a high-risk transfer, the bank app opens a short **Voice Check**. A conversational agent (AssemblyAI Voice Agent API) talks to the customer and checks the payee, while a parallel room-listening stream (AssemblyAI Realtime STT with speaker diarization) detects a *second voice* coaching the customer. The agent then releases the payment, applies a cooling-off hold, or escalates to a human fraud officer — with an auditable intervention record.

> Status: in design → build. See [`.claude/specs/2026-09-30-second-voice-design.md`](.claude/specs/2026-09-30-second-voice-design.md).

All banks, customers and data in this project are fictional ("Larkmoor Bank").

## License
MIT
