# Voice assistant setup

The command box always works with its local keyword parser. Two optional
OpenAI-compatible services make it understand free phrasing and recorded audio:

| Service | Environment | Used for |
| --- | --- | --- |
| Speech-to-text | `STT_URL` | Recorded mic audio, `POST /api/speech/transcribe` |
| Intent LLM with tools | `INTENT_LLM_URL` | Free phrasing, `POST /api/voice/interpret` |

Both are reached by the API server. Keys stay in the server environment and are
never sent to the browser.

## On premises

Run any OpenAI-compatible speech-to-text server and any OpenAI-compatible LLM
server that supports tool calling on the same network. Examples include
`whisper.cpp`'s server, `faster-whisper-server`, vLLM, llama.cpp's server, or
Ollama's OpenAI-compatible endpoint. These are examples only; use the server
your department supports.

Point the app at them in the repository-root `.env` (Vite also reads it as of
Phase 3):

```dotenv
STT_URL=http://127.0.0.1:8081
STT_MODEL=whisper-1
INTENT_LLM_URL=http://127.0.0.1:8000
INTENT_LLM_MODEL=your-local-model
```

The API server forwards the audio as `multipart/form-data` to
`${STT_URL}/v1/audio/transcriptions` and sends the tool request to
`${INTENT_LLM_URL}/v1/chat/completions`.

## Hosted

Set the same two URLs to a provider that exposes OpenAI-compatible endpoints,
and set `STT_KEY` / `INTENT_LLM_KEY` to the keys:

```dotenv
STT_URL=https://speech.example.com
STT_KEY=...
STT_MODEL=whisper-1
INTENT_LLM_URL=https://llm.example.com
INTENT_LLM_KEY=...
INTENT_LLM_MODEL=your-model
```

`STT_URL` and `INTENT_LLM_URL` are base URLs: the `/v1/...` path is added by
the server. If a key is empty no `Authorization` header is sent.

## Timeouts and limits

- `STT_TIMEOUT_MS` (default 15,000) for one transcription.
- `INTENT_LLM_TIMEOUT_MS` (default 6,000) for one interpretation. A timeout,
  HTTP error, invalid JSON, unknown tool or unresolved name falls back to the
  old parser; the commander never sees a failed request as an order.
- Audio is capped at 2 MB and must be `audio/webm` or `audio/ogg`.
- The intent request is one required tool call at temperature 0.

## What is logged

Every interpreted utterance is written to the server's `voice_log` table:
transcript, source (`browser`, `stt` or `typed`), the model's tool call or
`fallback`, the resolved summary, and the outcome (`confirmed`, `cancelled` or
`none`). A confirmation or cancellation adds a second entry with the final
outcome.

**No audio is stored.** Only the transcript and the resolved command are kept.
Rows older than `VOICE_LOG_DAYS` (default 30) are pruned when the server starts.

## Check it works

```bash
curl http://127.0.0.1:8787/api/speech/config
```

It returns `{ "stt": true, "llm": true }` when both URLs are set. With neither,
the box behaves exactly as before: typed commands and the browser's Web Speech
recogniser. With `STT_URL` set, the mic records and sends audio to your
speech-to-text server; without it, the browser recogniser is used.
