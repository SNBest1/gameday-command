import type { MapBundle } from '../../contracts.ts';

/**
 * The offline base map: one pixel per simulation cell, in the same muted
 * operational palette for both themes. It is always drawn under the deck
 * layers, so the Map view has streets, buildings, lots and the bowl even when
 * no tile style can load.
 */
type Rgb = [number, number, number];

interface Palette {
  blocked: Rgb;
  walk: Rgb;
  road: Rgb;
  stands: Rgb;
  concourse: Rgb;
  shelter: Rgb;
  parking: Rgb;
  field: Rgb;
  gate: Rgb;
}

const LIGHT: Palette = {
  blocked: [0x76, 0x79, 0x7d],
  walk: [0xe9, 0xe7, 0xe1],
  road: [0xb3, 0xb2, 0xad],
  stands: [0xc7, 0xc5, 0xbf],
  concourse: [0xd8, 0xd6, 0xd0],
  shelter: [0xdb, 0xdc, 0xd4],
  parking: [0xe2, 0xdd, 0xcf],
  field: [0xbb, 0xc2, 0xba],
  gate: [0x8a, 0x3f, 0x2b],
};

const DARK: Palette = {
  blocked: [0x0e, 0x10, 0x12],
  walk: [0x1d, 0x21, 0x24],
  road: [0x4b, 0x50, 0x56],
  stands: [0x33, 0x38, 0x3c],
  concourse: [0x2b, 0x30, 0x34],
  shelter: [0x24, 0x2b, 0x27],
  parking: [0x2a, 0x28, 0x22],
  field: [0x2c, 0x34, 0x30],
  gate: [0xd0, 0x8a, 0x5a],
};

export function basemapImage(map: MapBundle, theme: 'light' | 'dark'): ImageData {
  const palette = theme === 'dark' ? DARK : LIGHT;
  const field = new Set(map.field ?? []);
  const gates = new Set<number>();
  for (const place of map.places) {
    if (place.kind === 'gate') for (const cell of place.cells) gates.add(cell);
  }

  const image = new ImageData(map.width, map.height);
  const data = image.data;
  for (let i = 0; i < map.cells.length; i++) {
    const kind: keyof Palette = field.has(i) ? 'field' : gates.has(i) ? 'gate' : map.cells[i]!;
    const [r, g, b] = palette[kind];
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }
  return image;
}
