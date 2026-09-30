/**
 * Thin wrapper over the browser's speech synthesis — the simulator's "AI voice". No audio files, no accounts,
 * works offline on most phones. `pickVoice` is pure so it can be tested; the rest needs a browser.
 */

export interface VoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
}

/**
 * Prefers an English voice that sounds like a man on the phone (a typical "scam caller"), then any English voice,
 * then the first voice. Names vary by platform, so this is a heuristic, and the user can always choose another.
 */
export function pickVoice<T extends VoiceInfo>(voices: T[]): T | undefined {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const male = english.find((v) => /\b(david|daniel|george|james|mark|guy|male|arthur|ryan|thomas|alex)\b/i.test(v.name));
  return male ?? english[0] ?? voices[0];
}

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function listVoices(): SpeechSynthesisVoice[] {
  return speechSupported() ? window.speechSynthesis.getVoices() : [];
}

/** Calls `cb` now and whenever the voice list (which loads asynchronously) changes. Returns an unsubscribe. */
export function onVoicesChanged(cb: () => void): () => void {
  if (!speechSupported()) return () => {};
  cb();
  window.speechSynthesis.addEventListener('voiceschanged', cb);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', cb);
}

export interface SpeakOptions {
  voiceURI?: string;
  /** 0.5–1.5; 1 is normal. */
  rate: number;
  /** 0–1. Multiplies with the phone's own volume. */
  volume: number;
}

/** Speaks `text`; resolves when it finishes (or fails — a failed line must not wedge a scripted call). */
export function speak(text: string, opts: SpeakOptions): Promise<void> {
  return new Promise((resolve) => {
    if (!speechSupported()) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate;
    u.volume = opts.volume;
    const voice = listVoices().find((v) => v.voiceURI === opts.voiceURI);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export const stopSpeaking = () => {
  if (speechSupported()) window.speechSynthesis.cancel();
};
