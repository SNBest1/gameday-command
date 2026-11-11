import { useEffect, useRef, useState } from 'react';
import type { MapBundle } from '../../contracts.ts';
import { transcribeAudio } from './api.ts';
import { recordingClips } from './radio-audio.ts';
import { RADIO_COMMAND_EVENT } from './radio-event.ts';
import { readRadio, type RadioReport } from './radio.ts';
import { listen, speechConfig, speechConfigReady, speechSupported, type Listening } from './speech.ts';
import { TRANSCRIBING_WORDS } from './speech-recorded.ts';

const KEPT = 30;

interface Heard extends RadioReport {
  id: number;
  at: string;
}

/**
 * The radio monitor under the command box. Radio traffic comes in three ways:
 * a recording (transcribed by the speech service when one is configured,
 * otherwise played aloud for the browser's recogniser to hear), a scanner or
 * handset on the line-in ("Listen live"), or a pasted transcript. Each
 * transmission is read by `radio.ts` and logged. A report that asks for people
 * somewhere on the map offers one button, which hands the suggested command to
 * the command box to be confirmed there. The monitor itself orders nothing.
 */
export function RadioPanel({ map }: { map: MapBundle }) {
  const [heard, setHeard] = useState<Heard[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [typed, setTyped] = useState('');
  const nextId = useRef(1);
  const session = useRef<Listening | null>(null);
  const wantLive = useRef(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;

  const add = (transcript: string) => {
    const reports = readRadio(transcript, mapRef.current);
    if (reports.length === 0) return 0;
    const at = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    setHeard((prev) => [...reports.map((r) => ({ ...r, id: nextId.current++, at })).reverse(), ...prev].slice(0, KEPT));
    return reports.length;
  };

  /** Listen again and again until told to stop: one transmission, or one clip, at a time. */
  const listenLoop = () => {
    if (!wantLive.current) return;
    session.current = listen(
      (words, final) => {
        if (final && words !== TRANSCRIBING_WORDS) add(words);
      },
      (error) => {
        session.current = null;
        // "Nothing heard" is normal on a quiet channel; anything else stops the monitor.
        if (error && !/didn’t hear|did not hear/i.test(error)) {
          wantLive.current = false;
          setLive(false);
          setStatus(error);
          return;
        }
        if (wantLive.current) window.setTimeout(listenLoop, 150);
      },
    );
    if (!session.current) {
      wantLive.current = false;
      setLive(false);
      setStatus('This browser cannot listen. Open a recording or paste a transcript instead.');
    }
  };

  const stopLive = () => {
    wantLive.current = false;
    session.current?.stop();
    session.current = null;
    setLive(false);
  };

  const startLive = async (note: string) => {
    await speechConfigReady();
    if (!speechSupported()) {
      setStatus('This browser cannot listen. Open a recording or paste a transcript instead.');
      return false;
    }
    wantLive.current = true;
    setLive(true);
    setStatus(note);
    listenLoop();
    return true;
  };

  const openRecording = async (file: File) => {
    stopLive();
    setBusy(true);
    try {
      await speechConfigReady();
      if (speechConfig().stt) {
        setStatus(`Reading ${file.name}…`);
        const clips = await recordingClips(file);
        if (clips.length === 0) {
          setStatus(`${file.name} is silent.`);
          return;
        }
        let found = 0;
        for (let i = 0; i < clips.length; i++) {
          setStatus(`Transcribing ${file.name}: part ${i + 1} of ${clips.length}…`);
          found += add(await transcribeAudio(clips[i]!));
        }
        setStatus(
          found
            ? `${file.name}: ${found} ${found === 1 ? 'transmission' : 'transmissions'} read.`
            : `${file.name}: no speech found.`,
        );
        return;
      }
      // No speech service: play it through the speakers and let the browser's recogniser hear it.
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      player.current = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        player.current = null;
        // Give the recogniser a moment to finish the last sentence.
        window.setTimeout(() => {
          stopLive();
          setStatus(`${file.name} finished playing.`);
        }, 2500);
      };
      audio.onended = done;
      audio.onerror = () => {
        done();
        setStatus(`Could not play ${file.name}.`);
      };
      if (
        await startLive(
          `Playing ${file.name} aloud and listening. Turn the volume up; no speech service is set up, so the browser hears it through the microphone.`,
        )
      ) {
        await audio.play();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not read that recording.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(
    () => () => {
      wantLive.current = false;
      session.current?.stop();
      player.current?.pause();
    },
    [],
  );

  return (
    <details className="radio">
      <summary>
        Radio monitor
        {live && <span className="radio-live">listening</span>}
        {heard.length > 0 && <span className="radio-count">{heard.length}</span>}
      </summary>
      <div className="radio-tools">
        <button
          className={`small${live ? ' on' : ''}`}
          disabled={busy}
          onClick={() => {
            if (live) {
              player.current?.pause();
              stopLive();
              setStatus('Stopped listening.');
            } else
              void startLive('Listening to the microphone or line-in. Put the radio near it, or plug the scanner in.');
          }}
        >
          {live ? 'Stop listening' : 'Listen live'}
        </button>
        <label className="radio-file">
          <input
            type="file"
            accept="audio/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void openRecording(file);
            }}
          />
          <span>Open a recording</span>
        </label>
        <form
          className="radio-paste"
          onSubmit={(e) => {
            e.preventDefault();
            const found = add(typed);
            setStatus(found ? null : 'Nothing in that reads as a transmission.');
            if (found) setTyped('');
          }}
        >
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Or paste what was said: “Unit 12, crowd backing up at gate 2”"
            aria-label="Radio transcript"
          />
          <button className="small" disabled={!typed.trim()}>
            Read
          </button>
        </form>
      </div>
      {status && (
        <p className="radio-status" role="status">
          {status}
        </p>
      )}
      {heard.length > 0 && (
        <ol className="radio-log" aria-label="Radio transmissions, newest first">
          {heard.map((h) => (
            <li key={h.id} className={`radio-${h.kind.replace(/ /g, '-')}`}>
              <span className="radio-kind">{h.kind === 'other' ? 'heard' : h.kind}</span>
              <span className="radio-what">
                <strong>{h.summary}</strong>
                <em>
                  {h.at} “{h.text}”
                </em>
              </span>
              {h.suggestion && (
                <button
                  className="small"
                  title="Hand this to the command box, where you confirm it"
                  onClick={() => window.dispatchEvent(new CustomEvent(RADIO_COMMAND_EVENT, { detail: h.suggestion }))}
                >
                  {h.suggestion.replace(/^send/, 'Send')}?
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="radio-note">
        Radio only reports. A suggestion goes to the command box, and nothing happens until you confirm it there.
      </p>
    </details>
  );
}
