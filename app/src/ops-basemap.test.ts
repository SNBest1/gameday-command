import { describe, expect, it, vi } from 'vitest';
import { makeTestMap } from '../../world/src/test-map.ts';
import { basemapImage } from './ops-basemap.ts';

class TestImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

vi.stubGlobal('ImageData', TestImageData);

const pixel = (image: ImageData, cell: number) => [...image.data.slice(cell * 4, cell * 4 + 3)];

describe('offline basemap image', () => {
  it('is one pixel per cell and paints roads, buildings and gates differently', () => {
    const map = makeTestMap();
    // The hand-built test map has no road cells; mark one so the palette row is covered.
    const road = 7 * map.width + 5;
    const building = 3 * map.width;
    const gate = 3 * map.width + 3;
    const walk = 7 * map.width + 4;
    map.cells[road] = 'road';

    const image = basemapImage(map, 'light');
    expect(image.width).toBe(map.width);
    expect(image.height).toBe(map.height);
    expect(image.data).toHaveLength(map.width * map.height * 4);
    expect(pixel(image, road)).not.toEqual(pixel(image, building));
    expect(pixel(image, gate)).not.toEqual(pixel(image, walk));
  });

  it('uses a different palette in the dark theme', () => {
    const map = makeTestMap();
    const light = basemapImage(map, 'light');
    const dark = basemapImage(map, 'dark');
    const cell = 7 * map.width + 5;
    expect(pixel(dark, cell)).not.toEqual(pixel(light, cell));
  });
});
