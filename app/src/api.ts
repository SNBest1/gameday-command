import type {
  Briefing,
  BriefingRequest,
  DecisionDefaults,
  Id,
  Incident,
  IncidentKind,
  MapBundle,
  ResponsePlan,
  Scorecard,
} from '../../contracts.ts';
import type { MapGeoref } from '../../world/src/osm/georef.ts';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export const getMap = (id: Id) => getJson<MapBundle>(`/api/maps/${id}`);
export async function getMapGeo(id: Id): Promise<MapGeoref | null> {
  try {
    const res = await fetch(`/api/maps/${id}/geo`);
    if (!res.ok) return null;
    return (await res.json()) as MapGeoref;
  } catch {
    return null;
  }
}
export const getDecisionDefaults = () => getJson<DecisionDefaults>('/api/decision-defaults');
export const getPlans = (incident: IncidentKind) => getJson<ResponsePlan[]>(`/api/plans?incident=${incident}`);

export interface SpeechConfig {
  stt: boolean;
  llm: boolean;
}

export const getSpeechConfig = () => getJson<SpeechConfig>('/api/speech/config');

export async function transcribeAudio(blob: Blob): Promise<string> {
  const res = await fetch('/api/speech/transcribe', {
    method: 'POST',
    headers: { 'content-type': blob.type || 'audio/webm' },
    body: blob,
  });
  if (!res.ok) throw new Error(`speech-to-text returned ${res.status}`);
  const body = (await res.json()) as { text?: unknown; error?: unknown };
  if (typeof body.text !== 'string') throw new Error(typeof body.error === 'string' ? body.error : 'no transcript');
  return body.text;
}

export interface VoiceInterpretRequest {
  text: string;
  tools: unknown;
  system: string;
}

export interface VoiceInterpretResult {
  call: { name: string; arguments: unknown } | null;
  reason?: string;
}

export async function interpretVoice(request: VoiceInterpretRequest): Promise<VoiceInterpretResult> {
  try {
    const res = await fetch('/api/voice/interpret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) return { call: null, reason: `voice interpret returned ${res.status}` };
    return (await res.json()) as VoiceInterpretResult;
  } catch (error) {
    return { call: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

export interface VoiceLogEntry {
  session: string;
  source: 'browser' | 'stt' | 'typed';
  transcript: string;
  toolCall: { name: string; arguments: unknown } | 'fallback';
  summary: string;
  outcome: 'confirmed' | 'cancelled' | 'none';
}

export const logVoice = (entry: VoiceLogEntry) => postJson<VoiceLogEntry, { ok: true }>('/api/voice/log', entry);

async function postJson<Req, Res>(path: string, body: Req): Promise<Res> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as Res;
}

export const getBriefing = (req: BriefingRequest) => postJson<BriefingRequest, Briefing>('/api/briefing', req);

export const saveComparison = (incident: Incident, scorecards: Scorecard[]) =>
  postJson<{ incident: Incident; scorecards: Scorecard[] }, { id: Id }>('/api/comparisons', { incident, scorecards });
