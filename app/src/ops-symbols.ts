import type { OfficerStatus } from '../../engine/src/index.ts';
import { HOTSPOT_COLOUR, type HotspotLevel } from './congestion.ts';

/**
 * The Map view's symbols and colours, in one place. Neutral shapes and short
 * codes rather than team colours: a department standard can replace this file
 * without touching the layers.
 */
export type SymbolShape = 'circle' | 'chevron' | 'square' | 'diamond' | 'triangle' | 'bar';

export interface MapSymbol {
  code: string;
  label: string;
  shape: SymbolShape;
  rgb: [number, number, number];
}

const hexRgb = (hex: string): [number, number, number] => {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

export const UNIT_SYMBOLS: Record<OfficerStatus['state'], MapSymbol> = {
  standby: { code: 'U', label: 'Standby', shape: 'circle', rgb: [100, 116, 139] },
  en_route: { code: '›', label: 'En route', shape: 'chevron', rgb: [217, 119, 6] },
  on_scene: { code: '✓', label: 'On scene', shape: 'circle', rgb: [21, 128, 61] },
  patrolling: { code: 'P', label: 'Patrolling', shape: 'circle', rgb: [14, 116, 144] },
};

export const INCIDENT_SYMBOL: MapSymbol = {
  code: '!',
  label: 'Incident',
  shape: 'diamond',
  rgb: [225, 29, 72],
};

export const STAGING_SYMBOL: MapSymbol = { code: 'S', label: 'Staging', shape: 'square', rgb: [71, 85, 105] };
export const MEDICAL_SYMBOL: MapSymbol = { code: 'M', label: 'Medical', shape: 'square', rgb: [15, 118, 110] };
export const PA_SYMBOL: MapSymbol = { code: 'PA', label: 'PA marker', shape: 'triangle', rgb: [124, 58, 237] };
export const BARRICADE_SYMBOL: MapSymbol = { code: 'B', label: 'Barricade', shape: 'bar', rgb: [220, 38, 38] };

export const HOTSPOT_SYMBOLS: Record<HotspotLevel, MapSymbol> = {
  critical: { code: 'C', label: 'Critical', shape: 'circle', rgb: hexRgb(HOTSPOT_COLOUR.critical) },
  high: { code: 'H', label: 'High', shape: 'circle', rgb: hexRgb(HOTSPOT_COLOUR.high) },
  watch: { code: 'W', label: 'Watch', shape: 'circle', rgb: hexRgb(HOTSPOT_COLOUR.watch) },
};

export const COVERAGE_SYMBOLS = {
  covered: {
    code: 'C',
    label: 'Inside officer reach',
    shape: 'square' as const,
    rgb: [80, 140, 200] as [number, number, number],
  },
  reachable: {
    code: 'R',
    label: 'Reachable in a walk',
    shape: 'square' as const,
    rgb: [80, 140, 200] as [number, number, number],
  },
};

/** Map text: dark on light tiles, light on dark tiles, each with a contrasting outline. */
export const TEXT_SYMBOLS: Record<
  'light' | 'dark',
  { fill: [number, number, number, number]; outline: [number, number, number, number] }
> = {
  light: { fill: [15, 19, 23, 255], outline: [255, 255, 255, 235] },
  dark: { fill: [248, 250, 252, 255], outline: [8, 10, 12, 235] },
};
