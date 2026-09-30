## Submission Title
Second Voice: it hears the scam coach

## Short Description
A scam-interrupt voice agent for UK banks. It hears the scammer coaching a payment victim through the bank's questions, asks one gentle question, then holds or escalates the payment before the money moves. Built on AssemblyAI.

## Long Description
In authorised push payment scams the victim makes the payment themselves, often with a scammer still on the phone coaching them through the bank's checks: "tell her it's for a car deposit, don't mention me." UK banks lost £576.4m to these scams in 2025 (UK Finance), and since October 2024 the sending bank must reimburse eligible victims, so the loss now lands on the bank.

Second Voice is a short Voice Check that opens in the banking app when a payment looks risky. An AssemblyAI Voice Agent talks to the customer, asks what the payment is for, and runs the bank's checks (Confirmation of Payee, recipient-account risk, customer history) as tools. A second stream, AssemblyAI Realtime Speech-to-Text with speaker labels and loudness, listens to the whole room from the same microphone and looks for coaching language and for the customer repeating the coach's words. If it hears a coach, the agent gently asks: "Is there someone there with you?"

A transparent points table, never the LLM, decides: release, pause for 24 hours, or escalate to a fraud specialist. Every hold offers a human, and a fraud officer watches the same call live with an itemised "why this score" and an exportable audit record. It fails safe (mic denied or connection lost means a hold, never a release) and stores no audio.

Tested end to end in headless Chrome against the live APIs (coached scam escalated 7 of 7, honest customer released 2 of 2) with 455 automated tests. Limits are stated plainly: it hears coaching at conversational volume within arm's reach of the laptop, not whispers across a room.
