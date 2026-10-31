import type { Hono, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Db } from './db.ts';
import { clientKey, takeRate, type RateBucket } from './rate-limit.ts';

/**
 * Speech-to-text and intent-LLM routes. Both services are plain
 * OpenAI-compatible HTTP servers; keys stay here, never in the browser.
 */

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_INTERPRET_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 16 * 1024;
const MAX_TEXT_CHARS = 500;
const MAX_LOG_TEXT = 2000;
const MAX_TOOL_JSON = 8 * 1024;
const MAX_SYSTEM_CHARS = 8000;
/** The schema has 22 tools (6 orders, 8 controls, 6 questions, show_plan, none). */
const MAX_TOOLS = 24;
const DEFAULT_STT_TIMEOUT_MS = 15_000;
const DEFAULT_LLM_TIMEOUT_MS = 6000;

const env = (name: string) => process.env[name]?.trim() ?? '';
const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const baseUrl = (url: string) => url.replace(/\/+$/, '');

interface ToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters?: unknown };
}

interface VoiceLogBody {
  session?: string;
  source?: string;
  transcript?: string;
  toolCall?: unknown;
  summary?: string;
  outcome?: string;
}

const validTools = (tools: unknown): tools is ToolDefinition[] =>
  Array.isArray(tools) &&
  tools.length <= MAX_TOOLS &&
  tools.every(
    (tool) =>
      !!tool &&
      typeof tool === 'object' &&
      (tool as ToolDefinition).type === 'function' &&
      typeof (tool as ToolDefinition).function?.name === 'string',
  );

const failure = (reason: string) => ({ call: null, reason });

export function voiceRoutes(app: Hono, db: Db): void {
  const buckets = new Map<string, RateBucket>();
  const voiceLimit: MiddlewareHandler = async (c, next) => {
    const configured = Number(process.env.VOICE_RATE_PER_MIN ?? 30);
    const limit = Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 30;
    const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    const key = clientKey(
      incoming?.socket?.remoteAddress,
      c.req.header('x-forwarded-for'),
      process.env.TRUST_PROXY === '1',
    );
    if (!takeRate(buckets, key, limit, Date.now())) return c.json({ error: 'too many requests' }, 429);
    await next();
  };

  app.get('/api/speech/config', (c) =>
    c.json({
      stt: env('STT_URL') !== '',
      llm: env('INTENT_LLM_URL') !== '',
    }),
  );

  app.post(
    '/api/speech/transcribe',
    voiceLimit,
    bodyLimit({ maxSize: MAX_AUDIO_BYTES, onError: (c) => c.json({ error: 'audio is too large' }, 413) }),
    async (c) => {
      const target = env('STT_URL');
      if (!target) return c.json({ error: 'speech-to-text is not configured' }, 503);

      const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (type !== 'audio/webm' && type !== 'audio/ogg') {
        return c.json({ error: 'send audio/webm or audio/ogg' }, 415);
      }

      let audio: ArrayBuffer;
      try {
        audio = await c.req.arrayBuffer();
      } catch {
        return c.json({ error: 'could not read the audio body' }, 400);
      }
      // Second guard: a chunked body may not have had a Content-Length to check.
      if (audio.byteLength > MAX_AUDIO_BYTES) return c.json({ error: 'audio is too large' }, 413);

      const form = new FormData();
      form.set('file', new Blob([audio], { type }), 'audio');
      form.set('model', env('STT_MODEL') || 'whisper-1');
      form.set('language', 'en');
      const headers: Record<string, string> = {};
      if (env('STT_KEY')) headers.Authorization = `Bearer ${env('STT_KEY')}`;

      try {
        const response = await fetch(`${baseUrl(target)}/v1/audio/transcriptions`, {
          method: 'POST',
          headers,
          body: form,
          signal: AbortSignal.timeout(envNumber('STT_TIMEOUT_MS', DEFAULT_STT_TIMEOUT_MS)),
        });
        const data = (await response.json().catch(() => null)) as { text?: unknown } | null;
        if (!response.ok || typeof data?.text !== 'string') {
          return c.json({ error: `speech-to-text returned ${response.status}` }, 502);
        }
        return c.json({ text: data.text });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
      }
    },
  );

  app.post(
    '/api/voice/interpret',
    voiceLimit,
    bodyLimit({ maxSize: MAX_INTERPRET_BYTES, onError: (c) => c.json({ error: 'request is too large' }, 413) }),
    async (c) => {
      let body: { text?: unknown; tools?: unknown; system?: unknown };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid JSON' }, 400);
      }
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const system = typeof body.system === 'string' ? body.system : '';
      if (!text) return c.json({ error: 'text is required' }, 400);
      if (text.length > MAX_TEXT_CHARS) return c.json({ error: 'text is too long' }, 400);
      if (!validTools(body.tools)) return c.json({ error: 'tools must be at most 24 function definitions' }, 400);
      if (system.length > MAX_SYSTEM_CHARS) return c.json({ error: 'system prompt is too long' }, 400);

      const target = env('INTENT_LLM_URL');
      if (!target) return c.json(failure('intent LLM is not configured'));

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (env('INTENT_LLM_KEY')) headers.Authorization = `Bearer ${env('INTENT_LLM_KEY')}`;

    try {
      const response = await fetch(`${baseUrl(target)}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: env('INTENT_LLM_MODEL'),
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text },
          ],
          tools: body.tools,
          tool_choice: 'required',
          temperature: 0,
          stream: false,
        }),
        signal: AbortSignal.timeout(envNumber('INTENT_LLM_TIMEOUT_MS', DEFAULT_LLM_TIMEOUT_MS)),
      });
      if (!response.ok) return c.json(failure(`intent LLM returned ${response.status}`));
      const data = (await response.json().catch(() => null)) as {
        choices?: { message?: { tool_calls?: { function?: { name?: unknown; arguments?: unknown } }[] } }[];
      } | null;
      const call = data?.choices?.[0]?.message?.tool_calls?.[0]?.function;
      if (!call || typeof call.name !== 'string' || call.name === '') {
        return c.json(failure('no tool call'));
      }
      let args: unknown = call.arguments;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          return c.json(failure('tool arguments are not JSON'));
        }
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return c.json(failure('tool arguments are not an object'));
      }
      return c.json({ call: { name: call.name, arguments: args } });
    } catch (error) {
      return c.json(failure(error instanceof Error ? error.message : String(error)));
    }
  });

  app.post(
    '/api/voice/log',
    bodyLimit({ maxSize: MAX_LOG_BYTES, onError: (c) => c.json({ error: 'log entry is too large' }, 413) }),
    async (c) => {
      let body: VoiceLogBody;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid JSON' }, 400);
      }
      if (body.source !== 'browser' && body.source !== 'stt' && body.source !== 'typed') {
        return c.json({ error: 'source must be browser, stt or typed' }, 400);
      }
      const transcript = String(body.transcript ?? '');
      const summary = String(body.summary ?? '');
      if (transcript.length > MAX_LOG_TEXT || summary.length > MAX_LOG_TEXT) {
        return c.json({ error: 'transcript or summary is too long' }, 400);
      }
      const toolCall = body.toolCall === 'fallback' ? 'fallback' : JSON.stringify(body.toolCall ?? 'fallback');
      if (toolCall.length > MAX_TOOL_JSON) return c.json({ error: 'tool call is too large' }, 400);
      const outcome = body.outcome === 'confirmed' || body.outcome === 'cancelled' ? body.outcome : 'none';
      db.prepare(
        'insert into voice_log (at, session, source, transcript, tool_call, summary, outcome) values (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        new Date().toISOString(),
        String(body.session ?? ''),
        body.source,
        transcript,
        toolCall,
        summary,
        outcome,
      );
      return c.json({ ok: true });
    },
  );

  app.get('/api/voice/log', (c) => {
    const since = c.req.query('since') ?? '';
    const rows = db
      .prepare(
        'select id, at, session, source, transcript, tool_call, summary, outcome from voice_log where at >= ? order by id',
      )
      .all(since) as {
      id: number;
      at: string;
      session: string;
      source: string;
      transcript: string;
      tool_call: string;
      summary: string;
      outcome: string;
    }[];
    return c.json(
      rows.map((row) => ({
        id: row.id,
        at: row.at,
        session: row.session,
        source: row.source,
        transcript: row.transcript,
        toolCall: row.tool_call,
        summary: row.summary,
        outcome: row.outcome,
      })),
    );
  });
}
