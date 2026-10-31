/**
 * Speech to text for the command box's mic button. The browser's own
 * recogniser (Web Speech API) is the default; when the server reports a
 * configured speech-to-text service, recorded audio goes through that instead.
 * In Chrome the Web Speech API sends audio to Google, so it needs a connection;
 * Safari uses Apple's. Everything after the words come back (matching,
 * confirming, read-back) stays in the app.
 */
import { getSpeechConfig } from './api.ts';
import { listenRecorded } from './speech-recorded.ts';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

let recorded = false;
let llm = false;
let configPromise: Promise<void> | null = null;

/** Load the server's speech config once per page. */
export function speechConfigReady(): Promise<void> {
  if (!configPromise) {
    configPromise = getSpeechConfig()
      .then((config) => {
        recorded = config.stt;
        llm = config.llm;
      })
      .catch(() => {
        recorded = false;
        llm = false;
      });
  }
  return configPromise;
}
void speechConfigReady();

export const speechConfig = () => ({ stt: recorded, llm });
export const speechSupported = () => recorded || recognitionCtor() !== null;

/**
 * A sentence for the commander for each way listening can fail. Brave ships the
 * recogniser but blocks Google's speech service, so there it always fails as
 * `network`: say so rather than blame the connection.
 */
export function speechErrorText(code: string, brave = false): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone is blocked. Allow it from the icon in the address bar, then try again.';
    case 'audio-capture':
      return 'No microphone found. Plug one in or check your sound settings.';
    case 'no-speech':
      return 'I didn’t hear anything. Click the mic and speak right away.';
    case 'network':
      return brave
        ? 'Brave blocks the speech service this button uses. Open the app in Safari or Google Chrome, or use your Mac’s dictation (press Fn twice) in this box.'
        : 'The speech service could not be reached. Chrome needs an internet connection for this; you can still type.';
    case 'aborted':
      return '';
    default:
      return `Listening stopped (${code}). You can still type the order.`;
  }
}

export interface Listening {
  stop(): void;
}

/**
 * Listen for one order. `onWords` gets the words so far (`final` once the
 * speaker stops); `onEnd` runs once, with an error sentence if it failed.
 */
export function listen(
  onWords: (text: string, final: boolean) => void,
  onEnd: (error: string | null) => void,
): Listening | null {
  if (recorded) return listenRecorded(onWords, onEnd);
  return listenBrowser(onWords, onEnd);
}

function listenBrowser(
  onWords: (text: string, final: boolean) => void,
  onEnd: (error: string | null) => void,
): Listening | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let error: string | null = null;
  let ended = false;
  rec.onresult = (e) => {
    let text = '';
    let final = true;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i]![0].transcript;
      if (!e.results[i]!.isFinal) final = false;
    }
    onWords(text.trim(), final);
  };
  const brave = 'brave' in navigator;
  rec.onerror = (e) => {
    error = speechErrorText(e.error, brave) || null;
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    onEnd(error);
  };
  try {
    rec.start();
  } catch {
    return null;
  }
  return { stop: () => rec.stop() };
}
