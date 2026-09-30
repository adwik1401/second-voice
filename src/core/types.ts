/** Shared types for the pure decision logic (no browser / network dependencies). */

/** Confirmation of Payee outcome for the recipient of a transfer. */
export type CopResult = 'MATCH' | 'CLOSE_MATCH' | 'NO_MATCH' | 'UNAVAILABLE';

/** One word from the room stream (Realtime STT). Timings are ms from the first audio frame of that stream. */
export interface RoomWord {
  text: string;
  start?: number;
  end?: number;
  /** Diarization label. `PENDING`, `?` and '' mean "not assigned yet". */
  speaker?: string;
  /** Loudness of the word in dBFS, when the Room Listener could measure it. */
  dbfs?: number | null;
}

/** A finalised room-stream turn. */
export interface RoomTurn {
  /** Wall-clock ms when the turn arrived. */
  at: number;
  speaker: string;
  words: RoomWord[];
}

/** One line of the Voice Agent conversation (`transcript.user` / `transcript.agent`). */
export interface ConversationTurn {
  /** Wall-clock ms when the transcript arrived. */
  at: number;
  role: 'customer' | 'agent';
  text: string;
}

/** A wall-clock interval, e.g. `input.speech.started` → `input.speech.stopped` on the agent stream. */
export interface TimeWindow {
  start: number;
  end: number;
}
