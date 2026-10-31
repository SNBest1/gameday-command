import { transcribeAudio } from './api.ts';
import type { Listening } from './speech.ts';

/** `onWords` sentinel while the recorded clip is being transcribed. */
export const TRANSCRIBING_WORDS = '\u0000transcribing';

const MAX_RECORD_MS = 12_000;
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];

const errorText = (error: unknown) => {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'The microphone is blocked. Allow it from the icon in the address bar, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No microphone found. Plug one in or check your sound settings.';
  return 'Could not record audio. You can still type the order.';
};

/**
 * Record one clip and transcribe it through the API server. The signature is
 * the same as `listen`; no interim words exist, so the box shows a transcribing
 * state until the text arrives.
 */
export function listenRecorded(
  onWords: (text: string, final: boolean) => void,
  onEnd: (error: string | null) => void,
): Listening | null {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let stopped = false;
  let finished = false;
  let timer: number | null = null;
  const chunks: Blob[] = [];

  const cleanup = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  };
  const finish = (error: string | null) => {
    if (finished) return;
    finished = true;
    cleanup();
    onEnd(error);
  };
  const stop = () => {
    stopped = true;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else if (!recorder) finish(null);
  };

  void navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((captured) => {
      if (stopped || finished) {
        for (const track of captured.getTracks()) track.stop();
        finish(null);
        return;
      }
      stream = captured;
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
      recorder = mimeType ? new MediaRecorder(captured, { mimeType }) : new MediaRecorder(captured);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => finish('Could not record audio. You can still type the order.');
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType || 'audio/webm' });
        onWords(TRANSCRIBING_WORDS, false);
        void transcribeAudio(blob)
          .then((text) => {
            if (text.trim()) onWords(text.trim(), true);
            else finish('I didn’t hear anything. Click the mic and speak right away.');
            finish(null);
          })
          .catch(() => finish('The speech service could not be reached. You can still type the order.'));
      };
      recorder.start();
      timer = window.setTimeout(stop, MAX_RECORD_MS);
    })
    .catch((error) => finish(errorText(error)));

  return { stop };
}
