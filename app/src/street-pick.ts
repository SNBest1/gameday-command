import type { MapBundle } from '../../contracts.ts';

/**
 * The click rule the close-up has always used for a police order: any cell
 * that is not a building or wall can take the click. The barricade order then
 * snaps to the nearest road itself (`nearestRoad` in barricade.ts).
 */
export function streetPickAt(map: MapBundle, cell: number): number {
  if (!Number.isInteger(cell) || cell < 0 || cell >= map.width * map.height) return -1;
  return map.cells[cell] === 'blocked' ? -1 : cell;
}
