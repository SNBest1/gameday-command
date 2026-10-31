import type { CellKind, MapBundle, Place } from '../contracts.ts';
import { CONTRACT_VERSION } from '../contracts.ts';

const SOURCE = [{ label: 'Hand-built validation fixture', url: 'local' }];

/**
 * A 50 m unidirectional corridor, 6 m wide, with a parking lot at the entry
 * and a gate and seating at the far end. Cells are 2 m; the corridor is 25
 * cells long and 3 cells wide.
 */
export function corridorMap(): MapBundle {
  const width = 70;
  const height = 3;
  const cells: CellKind[] = Array(width * height).fill('blocked');
  // Entry lot: x = 0..24, enough cells for the test crowd at the 4-dot cap.
  for (let x = 0; x <= 24; x++) for (let y = 0; y < height; y++) cells[y * width + x] = 'parking';
  // 25-cell (50 m) corridor, gate and seat beyond it.
  for (let x = 25; x <= 49; x++) for (let y = 0; y < height; y++) cells[y * width + x] = 'walk';
  for (let x = 50; x < width; x++) for (let y = 0; y < height; y++) cells[y * width + x] = 'walk';

  const lotCells: number[] = [];
  const corridorCells: number[] = [];
  for (let x = 0; x <= 49; x++)
    for (let y = 0; y < height; y++) {
      if (x <= 24) lotCells.push(y * width + x);
      else corridorCells.push(y * width + x);
    }
  const gateCells = [0, 1, 2].map((y) => y * width + 50);
  const seatCells: number[] = [];
  for (let x = 51; x < width; x++) for (let y = 0; y < height; y++) seatCells.push(y * width + x);

  const places: Place[] = [
    { id: 'val-corridor-lot', name: 'Validation entry lot', kind: 'parking', cells: lotCells, capacity: 10_000 },
    {
      id: 'val-corridor-gate',
      name: 'Validation corridor gate',
      kind: 'gate',
      cells: gateCells,
      capacity: 10_000,
      throughputPerMin: 1_000_000,
    },
    { id: 'val-corridor-seats', name: 'Validation seats', kind: 'seating', cells: seatCells, capacity: 10_000 },
  ];

  return {
    version: CONTRACT_VERSION,
    id: 'validation-corridor',
    name: 'Validation corridor, 50 m',
    width,
    height,
    cells,
    places,
    closables: [],
    sources: SOURCE,
  };
}

/**
 * A 20 m x 18 m room with one opening in its right wall. The room is all
 * parking, so fans start inside it and walk to the gate in the opening.
 * `openingCells` is 1, 2, 3 or 4 cells (2, 4, 6 or 8 m).
 */
export function roomMap(openingCells: number): MapBundle {
  const width = 16;
  const height = 10;
  const cells: CellKind[] = Array(width * height).fill('blocked');
  for (let x = 0; x <= 8; x++) for (let y = 0; y < height; y++) cells[y * width + x] = 'parking';
  const first = Math.floor((height - openingCells) / 2);
  const openingRows = Array.from({ length: openingCells }, (_, i) => first + i);
  for (const y of openingRows) cells[y * width + 9] = 'walk';
  for (let x = 10; x < width; x++) for (let y = 0; y < height; y++) cells[y * width + x] = 'walk';

  const roomCells: number[] = [];
  for (let x = 0; x <= 8; x++) for (let y = 0; y < height; y++) roomCells.push(y * width + x);
  const gateCells = openingRows.map((y) => y * width + 9);
  const seatCells: number[] = [];
  for (let x = 10; x < width; x++) for (let y = 0; y < height; y++) seatCells.push(y * width + x);

  const places: Place[] = [
    { id: 'val-room', name: 'Validation room', kind: 'parking', cells: roomCells, capacity: 10_000 },
    {
      id: 'val-room-gate',
      name: `Validation opening, ${openingCells * 2} m`,
      kind: 'gate',
      cells: gateCells,
      capacity: 10_000,
      throughputPerMin: 1_000_000,
    },
    { id: 'val-room-seats', name: 'Validation outside', kind: 'seating', cells: seatCells, capacity: 10_000 },
  ];

  return {
    version: CONTRACT_VERSION,
    id: `validation-room-${openingCells * 2}m`,
    name: `Validation room, ${openingCells * 2} m opening`,
    width,
    height,
    cells,
    places,
    closables: [],
    sources: SOURCE,
  };
}
