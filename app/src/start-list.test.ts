import { describe, expect, it } from 'vitest';
import { orderStadiums, whereText } from './start-list.ts';

describe('start screen stadium list', () => {
  it('shows each stadium once, built-ins first and the practice map last', () => {
    const rows = [
      { id: 'test-3gate', name: 'Three-gate test map' },
      { id: 'osm-b2', name: 'Beaver Stadium', imported: true },
      { id: 'osm-ohio', name: 'Ohio Stadium', imported: true },
      { id: 'ohio-stadium', name: 'Ohio Stadium + 0.5 mi' },
      { id: 'osm-a', name: 'Allianz Arena', imported: true },
      { id: 'osm-b1', name: 'Beaver Stadium', imported: true },
    ];
    expect(orderStadiums(rows).map((r) => r.id)).toEqual(['ohio-stadium', 'osm-a', 'osm-b2', 'test-3gate']);
  });

  it('leaves out a location that only repeats the name', () => {
    expect(whereText('Michigan Stadium', 'Michigan Stadium')).toBe('');
    expect(whereText('Wembley Stadium', 'Greater London, England')).toBe('Greater London, England');
  });
});
