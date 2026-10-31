import { useEffect, useRef } from 'react';
import { addProtocol, Map as MapLibreMap, removeProtocol, type StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { BitmapLayer, type BitmapLayerProps } from '@deck.gl/layers';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getMapGeo } from './api.ts';
import type { CrowdViewProps } from './CrowdView.tsx';
import { basemapImage } from './ops-basemap.ts';
import { flatGeoref, mapBounds } from './ops-geo.ts';
import type { MapGeoref } from '../../world/src/osm/georef.ts';

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_TIMEOUT_MS = 5000;

const themeColour = (theme: 'light' | 'dark') => (theme === 'dark' ? '#14171a' : '#e9e7e1');

function currentTheme(): 'light' | 'dark' {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The configured style, or '' when the deployment wants the built-in grid only. */
function configuredStyle(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const value = env?.VITE_MAP_STYLE;
  return value === undefined ? DEFAULT_STYLE : value.trim();
}

function blankStyle(theme: 'light' | 'dark'): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': themeColour(theme) } }],
  };
}

/**
 * The operations map. MapLibre owns the WebGL context; deck.gl shares it
 * through an interleaved MapboxOverlay, and the offline grid basemap is
 * always one of its layers.
 */
export function OpsMap(props: CrowdViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bundle = props.map;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let map: MapLibreMap | null = null;
    let overlay: MapboxOverlay | null = null;
    let timer: number | undefined;
    let theme = currentTheme();
    let fallback = false;
    let georef: MapGeoref = flatGeoref(bundle.width);
    let disconnectTheme: (() => void) | undefined;

    const setBasemap = () => {
      if (!map || !overlay) return;
      const firstSymbol = map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id;
      const layer = new BitmapLayer({
        id: 'ops-basemap',
        image: basemapImage(bundle, theme),
        bounds: mapBounds(georef, bundle.width, bundle.height),
        pickable: false,
        ...(firstSymbol ? { beforeId: firstSymbol } : {}),
      } as unknown as BitmapLayerProps);
      overlay.setProps({ layers: [layer] });
    };

    const useFallback = () => {
      if (!map || fallback) return;
      fallback = true;
      theme = currentTheme();
      map.setStyle(blankStyle(theme));
      setBasemap();
    };

    const start = async () => {
      const fetched = await getMapGeo(bundle.id);
      if (disposed) return;
      georef = fetched ?? flatGeoref(bundle.width);
      const bounds = mapBounds(georef, bundle.width, bundle.height);
      const style = configuredStyle();
      const gridOnly = fetched === null || style === '' || navigator.onLine === false;
      fallback = gridOnly;
      theme = currentTheme();
      addProtocol('pmtiles', new Protocol().tile);

      const [west, south] = bounds[0];
      const [east, north] = bounds[1];
      const padX = (east - west) * 0.2;
      const padY = (north - south) * 0.2;
      const { lon, lat } = georef.center;

      map = new MapLibreMap({
        container: host,
        style: gridOnly ? blankStyle(theme) : style,
        center: [lon, lat],
        bounds,
        fitBoundsOptions: { padding: 24, maxZoom: 18 },
        maxBounds: [
          [west - padX, south - padY],
          [east + padX, north + padY],
        ],
      });
      overlay = new MapboxOverlay({ interleaved: true, layers: [] });
      map.addControl(overlay);

      map.once('load', () => {
        if (timer !== undefined) window.clearTimeout(timer);
        setBasemap();
      });

      if (!gridOnly) timer = window.setTimeout(() => useFallback(), STYLE_TIMEOUT_MS);
      else setBasemap();

      const setTheme = () => {
        const next = currentTheme();
        if (next === theme) return;
        theme = next;
        if (fallback) map?.setPaintProperty('bg', 'background-color', themeColour(theme));
        setBasemap();
      };
      const observer = new MutationObserver(setTheme);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', setTheme);

      if (disposed) {
        observer.disconnect();
        media.removeEventListener('change', setTheme);
        return;
      }
      disconnectTheme = () => {
        observer.disconnect();
        media.removeEventListener('change', setTheme);
      };
    };

    void start();

    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      disconnectTheme?.();
      if (overlay) overlay.finalize();
      map?.remove();
      removeProtocol('pmtiles');
    };
  }, [bundle]);

  return <div className="ops-map" ref={hostRef} />;
}
