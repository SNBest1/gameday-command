import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, pruneVoiceLog } from './db.ts';
import { createApp } from './index.ts';

interface FakeStt {
  type: string;
  size: number;
  model: string | null;
  language: string | null;
}

let sttSeen: FakeStt | null = null;
let llmMode: 'ok' | 'error' | 'timeout' | 'badargs' | 'notool' = 'ok';
let llmBody: Record<string, unknown> | null = null;

const sttApp = new Hono();
sttApp.post('/v1/audio/transcriptions', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  sttSeen = {
    type: file instanceof File ? file.type : '',
    size: file instanceof File ? file.size : 0,
    model: form.get('model')?.toString() ?? null,
    language: form.get('language')?.toString() ?? null,
  };
  return c.json({ text: 'close gate two' });
});

const llmApp = new Hono();
llmApp.post('/v1/chat/completions', async (c) => {
  llmBody = await c.req.json();
  if (llmMode === 'error') return c.text('boom', 500);
  if (llmMode === 'timeout') {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return c.json({ choices: [{ message: { tool_calls: [] } }] });
  }
  if (llmMode === 'notool') return c.json({ choices: [{ message: { content: 'no tool' } }] });
  const args = llmMode === 'badargs' ? '{"target":' : JSON.stringify({ target: 'Gate 2', atMin: 0 });
  return c.json({
    choices: [{ message: { tool_calls: [{ function: { name: 'close', arguments: args } }] } }],
  });
});

const servers: { close: () => void }[] = [];
async function start(app: Hono): Promise<string> {
  const server = serve({ fetch: app.fetch, port: 0 });
  const port = (server.address() as AddressInfo).port;
  servers.push({ close: () => server.close() });
  return `http://127.0.0.1:${port}`;
}

const sttUrl = await start(sttApp);
const llmUrl = await start(llmApp);

afterAll(() => {
  for (const server of servers) server.close();
});

beforeEach(() => {
  sttSeen = null;
  llmMode = 'ok';
  llmBody = null;
  process.env.STT_URL = '';
  process.env.INTENT_LLM_URL = '';
  process.env.INTENT_LLM_TIMEOUT_MS = '6000';
  delete process.env.VOICE_RATE_PER_MIN;
  delete process.env.TRUST_PROXY;
});

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const tools = [
  {
    type: 'function',
    function: {
      name: 'close',
      description: 'Close a gate',
      parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
    },
  },
];

describe('voice routes', () => {
  it('reports which services are configured', async () => {
    const app = createApp(openDb(':memory:'));
    expect(await (await app.request('/api/speech/config')).json()).toEqual({ stt: false, llm: false });
    process.env.STT_URL = sttUrl;
    process.env.INTENT_LLM_URL = llmUrl;
    expect(await (await app.request('/api/speech/config')).json()).toEqual({ stt: true, llm: true });
  });

  it('forwards audio as multipart and returns the transcript', async () => {
    process.env.STT_URL = sttUrl;
    const app = createApp(openDb(':memory:'));
    const res = await app.request('/api/speech/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'audio/webm;codecs=opus' },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'close gate two' });
    expect(sttSeen).toMatchObject({ type: 'audio/webm', size: 4, model: 'whisper-1', language: 'en' });
  });

  it('rejects audio over 2 MB with 413', async () => {
    process.env.STT_URL = sttUrl;
    const app = createApp(openDb(':memory:'));
    const res = await app.request('/api/speech/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'audio/webm' },
      body: new Uint8Array(2 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });

  it('returns a parsed tool call from the intent LLM', async () => {
    process.env.INTENT_LLM_URL = llmUrl;
    process.env.INTENT_LLM_MODEL = 'fake';
    const app = createApp(openDb(':memory:'));
    const res = await post(app, '/api/voice/interpret', { text: 'close gate 2', tools, system: 'test' });
    expect(await res.json()).toEqual({ call: { name: 'close', arguments: { target: 'Gate 2', atMin: 0 } } });
    expect(llmBody).toMatchObject({ model: 'fake', tool_choice: 'required', temperature: 0, stream: false });
  });

  it('returns call null on HTTP errors, timeouts, bad arguments and no tool call', async () => {
    process.env.INTENT_LLM_URL = llmUrl;
    const app = createApp(openDb(':memory:'));

    llmMode = 'error';
    expect((await (await post(app, '/api/voice/interpret', { text: 'x', tools, system: '' })).json()).call).toBeNull();

    llmMode = 'timeout';
    process.env.INTENT_LLM_TIMEOUT_MS = '50';
    expect((await (await post(app, '/api/voice/interpret', { text: 'x', tools, system: '' })).json()).call).toBeNull();
    process.env.INTENT_LLM_TIMEOUT_MS = '6000';

    llmMode = 'badargs';
    expect((await (await post(app, '/api/voice/interpret', { text: 'x', tools, system: '' })).json()).call).toBeNull();

    llmMode = 'notool';
    expect((await (await post(app, '/api/voice/interpret', { text: 'x', tools, system: '' })).json()).call).toBeNull();
  });

  it('caps interpret text and its body', async () => {
    const app = createApp(openDb(':memory:'));
    const long = await post(app, '/api/voice/interpret', { text: 'x'.repeat(501), tools, system: '' });
    expect(long.status).toBe(400);

    const huge = await post(app, '/api/voice/interpret', { text: 'x', tools, system: 'y'.repeat(70 * 1024) });
    expect(huge.status).toBe(413);
  });

  it('rate-limits transcribe and interpret together', async () => {
    process.env.VOICE_RATE_PER_MIN = '2';
    const app = createApp(openDb(':memory:'));
    expect((await post(app, '/api/voice/interpret', { text: 'one', tools, system: '' })).status).toBe(200);
    expect((await post(app, '/api/voice/interpret', { text: 'two', tools, system: '' })).status).toBe(200);
    const third = await post(app, '/api/voice/interpret', { text: 'three', tools, system: '' });
    expect(third.status).toBe(429);
    const transcribe = await app.request('/api/speech/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'audio/webm' },
      body: new Uint8Array([1]),
    });
    expect(transcribe.status).toBe(429);
  });

  it('stores, lists and prunes the voice log', async () => {
    const db = openDb(':memory:');
    const app = createApp(db);
    await post(app, '/api/voice/log', {
      session: 's1',
      source: 'typed',
      transcript: 'close gate 2',
      toolCall: { name: 'close', arguments: { target: 'Gate 2' } },
      summary: 'Close Gate 2, now',
      outcome: 'confirmed',
    });
    const rows = (await (await app.request('/api/voice/log')).json()) as {
      transcript: string;
      toolCall: string;
      outcome: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ transcript: 'close gate 2', outcome: 'confirmed' });
    expect(JSON.parse(rows[0]!.toolCall)).toMatchObject({ name: 'close' });

    db.prepare(
      'insert into voice_log (at, session, source, transcript, tool_call, summary, outcome) values (?, ?, ?, ?, ?, ?, ?)',
    ).run('2000-01-01T00:00:00.000Z', 'old', 'typed', 'old', 'fallback', 'old', 'none');
    expect(pruneVoiceLog(db, 30)).toBe(1);
    const left = (await (await app.request('/api/voice/log')).json()) as unknown[];
    expect(left).toHaveLength(1);
  });
});
