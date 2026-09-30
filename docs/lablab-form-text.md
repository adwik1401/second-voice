## Submission Title
Second Voice: it hears the scam coach

## Short Description
A scam-interrupt voice agent for UK banks. It hears the scammer coaching a payment victim through the bank's questions, asks one gentle question, then holds or escalates the payment before the money moves. Built on AssemblyAI.

## Long Description
In authorised push payment scams the victim makes the payment themselves, often with a scammer still on the phone coaching them through the bank's checks: "tell her it's for a car deposit, don't mention me." UK banks lost £576.4m to these scams in 2025 (UK Finance), and since October 2024 the sending bank must reimburse eligible victims, so the loss now lands on the bank.

Second Voice is a short Voice Check that opens in the banking app when a payment looks risky. An AssemblyAI Voice Agent talks to the customer, asks what the payment is for, and runs the bank's checks (Confirmation of Payee, recipient-account risk, customer history) as tools. A second stream, AssemblyAI Realtime Speech-to-Text with speaker labels and loudness, listens to the whole room from the same microphone and looks for coaching language and for the customer repeating the coach's words. If it hears a coach, the agent gently asks: "Is there someone there with you?"

A transparent points table, never the LLM, decides: release, pause for 24 hours, or escalate to a fraud specialist. Every hold offers a human, and a fraud officer watches the same call live with an itemised "why this score" and an exportable audit record. It fails safe (mic denied or connection lost means a hold, never a release) and stores no audio.

Tested end to end in headless Chrome against the live APIs (coached scam escalated 7 of 7, honest customer released 2 of 2) with 455 automated tests. Limits are stated plainly: it hears coaching at conversational volume within arm's reach of the laptop, not whispers across a room.

## Additional Information
HOW TO TRY IT
Open https://second-voice-larkmoor.netlify.app on a laptop (Chrome, allow the microphone, no headphones). Pick "£8,000 to a car dealer", Send, Start voice check. To play the scammer, open /simulator on a phone, put it on speakerphone next to the laptop and tap "Play a coached call". The fraud officer panel on the right shows the live score and why. The £1,200 plumber scenario shows an honest customer being released.

ASSEMBLYAI USAGE
- Voice Agent API: a stored agent with six client-side tools (payee check, recipient risk, customer history, record answer, decide payment, hand to human), far-field voice focus, trusted system messages to make it ask one gentle question, reply.create, and session.resume for reconnects.
- Realtime Speech-to-Text (universal-3-6-pro): a second stream from the same microphone, with speaker labels and per-word loudness, to hear the room.

WHAT WE LEARNED
- One shared mic stream with echo cancellation on beats two separate mics; two different streams silently lost echo cancellation.
- Coaching detection is rules-first (instant, offline, immune to "ignore your rules" prompt injection): 16/16 on labelled cases, 8/10 on held-out, zero false alarms. An LLM second opinion is optional.
- Live runs caught five real bugs that unit tests could not, all fixed.

HONEST LIMITS
- It hears coaching at conversational volume within arm's reach of the laptop, not whispers across a room. Louder sources are caught from farther away.
- Speaker labels are only a tie-breaker. The agent speaks English; it understands 18 languages.
- The demo video uses the real agent voice and live system output, but the customer and scammer voices are synthetic. All banks, people and accounts are fictional.

WHAT'S NEXT
A range study, an inbound phone channel through a SIP trunk, and a pilot with a real bank's fraud team.

Code (MIT): github.com/adwik1401/second-voice
