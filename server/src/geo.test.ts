import { describe, expect, it } from 'vitest';
import { makeTestMap } from '../../world/src/test-map.ts';
import { STADIUM_MAP_ID } from '../../world/src/osm/stadium.ts';
import { openDb } from './db.ts';
import { createApp } from './index.ts';

describe('map georeference route', () => {
  it('answers for the Ohio map and rejects a map with no location', async () => {
    const app = createApp(openDb(':memory:'));

    const ohio = await app.request(`/api/maps/${STADIUM_MAP_ID}/geo`);
    expect(ohio.status).toBe(200);
    const geo = (await ohio.json()) as {
      center: { lat: number; lon: number };
      radiusM: number;
      cellSizeM: number;
    };
    expect(geo.center.lat).toBeGreaterThan(39.9);
    expect(geo.center.lat).toBeLessThan(40.1);
    expect(geo.radiusM).toBeGreaterThan(0);
    expect(geo.cellSizeM).toBe(2);

    const test = await app.request(`/api/maps/${makeTestMap().id}/geo`);
    expect(test.status).toBe(404);
    expect(await test.json()).toEqual({ error: 'no location' });
  });
});
