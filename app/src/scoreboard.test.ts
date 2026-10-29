import { describe, expect, it } from 'vitest';
import type { Scorecard } from '../../contracts.ts';
import { liveRows, resultRows } from './scoreboard.ts';

const card = (over: Partial<Scorecard>): Scorecard => ({
  runId: 'r', planId: 'p', label: 'A', timeToClearMin: 10, peakDensity: 5, dangerMinutes: 100, firstOfficerMin: 1,
  officerMinutesUsed: 60, fansNotReached: 0, fallbackDecisions: 0, ...over,
});

describe('plan scoreboard', () => {
  it('marks the lowest live count, and nothing on a tie', () => {
    const rows = liveRows([{ zonePeople: 75, dangerPeople: 12595 }, { zonePeople: 65, dangerPeople: 12345 }, { zonePeople: 65, dangerPeople: 13000 }]);
    expect(rows[0]).toMatchObject({ cells: ['75', '65', '65'], best: null });
    expect(rows[1]).toMatchObject({ cells: ['12,595', '12,345', '13,000'], best: 1 });
  });

  it('counts never-cleared as worse than any time', () => {
    const rows = resultRows([card({ timeToClearMin: null }), card({ timeToClearMin: 19.4 }), card({ timeToClearMin: 26.9 })]);
    expect(rows[0]).toMatchObject({ cells: ['never', '19.4 min', '26.9 min'], best: 1 });
    expect(resultRows([card({ timeToClearMin: null }), card({ timeToClearMin: null }), card({ timeToClearMin: null })])[0]!.best).toBeNull();
  });
});
