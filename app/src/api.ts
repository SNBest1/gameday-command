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
