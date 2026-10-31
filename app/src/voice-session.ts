/** One audit session per page load; the server never invents it. */
export const VOICE_SESSION_ID =
  globalThis.crypto?.randomUUID?.() ?? `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
