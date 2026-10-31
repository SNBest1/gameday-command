import { useEffect, useRef } from 'react';
import { addProtocol, Map as MapLibreMap, removeProtocol, type StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  BitmapLayer,
  PathLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
  type BitmapLayerProps,
  type PathLayerProps,
  type PolygonLayerProps,
  type ScatterplotLayerProps,
  type TextLayerProps,
} from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { Protocol } from 'pmtiles';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getMapGeo } from './api.ts';
import type { CrowdViewProps } from './CrowdView.tsx';
import { basemapImage } from './ops-basemap.ts';
import { flatGeoref, mapBounds } from './ops-geo.ts';
import {
  opsLayerProps,
  type OpsLayerProps,
  type PathDatum,
  type PointDatum,
  type PolygonDatum,
  type TextDatum,
} from './ops-layers.ts';
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

/** Turn the plain props from ops-layers into deck.gl layer instances. */
function makeLayers(specs: OpsLayerProps): Layer[] {
  return [
    new BitmapLayer(specs.density as unknown as BitmapLayerProps),
    new ScatterplotLayer(specs.fans as unknown as ScatterplotLayerProps<PointDatum>),
    new ScatterplotLayer(specs.vehicles as unknown as ScatterplotLayerProps<PointDatum>),
    new ScatterplotLayer(specs.hotspots as unknown as ScatterplotLayerProps<PointDatum>),
    new PathLayer(specs.routes as unknown as PathLayerProps<PathDatum>),
    new PolygonLayer(specs.coverage as unknown as PolygonLayerProps<PolygonDatum>),
    new PolygonLayer(specs.closures as unknown as PolygonLayerProps<PolygonDatum>),
    new PolygonLayer(specs.incident as unknown as PolygonLayerProps<PolygonDatum>),
    new ScatterplotLayer(specs.officers as unknown as ScatterplotLayerProps<PointDatum>),
    new TextLayer({
      ...specs.gates,
      fontFamily: 'system-ui, sans-serif',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
    } as unknown as TextLayerProps<TextDatum>),
  ];
}

/**
 * The operations map. MapLibre owns the WebGL context; deck.gl shares it
 * through an interleaved MapboxOverlay, and the offline grid basemap is
 * always one of its layers.
 */
export function OpsMap(props: CrowdViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bundle = props.map;
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const georefRef = useRef<MapGeoref>(flatGeoref(bundle.width));
  const basemapRef = useRef<BitmapLayer | null>(null);
  const zoomRef = useRef(10);
  const drawRef = useRef<() => void>(() => {});

  const draw = () => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const kept = props.run.frames.current ?? [];
    const view =
      props.scrubIndex === null
        ? props.run.latest.current
        : (kept[Math.min(props.scrubIndex, kept.length - 1)] ?? props.run.latest.current);
    const live = props.scrubIndex === null;
    const layers: Layer[] = [];
    if (basemapRef.current) layers.push(basemapRef.current);
    if (view) {
      const specs = opsLayerProps({
        map: bundle,
        geo: georefRef.current,
        frame: view.frame,
        density: view.density,
        scene: live ? props.run.scene.current : null,
        zoom: zoomRef.current,
        dangerDensity: props.dangerDensity,
        selectedBand: props.selectedBand,
        showVehicles: props.showVehicles,
        showFlow: props.showFlow,
        vehicleFocus: props.vehicleFocus,
        selectedVehicle: props.selectedVehicle,
        selectedOfficer: props.selectedOfficer,
        showCoverage: !!props.showCoverage,
        hotspots: props.hotspots,
        incidentCells: props.incidentCells,
        incidentLabel: props.incidentLabel,
      });
      for (const layer of makeLayers(specs)) layers.push(layer);
    }
    overlay.setProps({ layers });
  };
  drawRef.current = draw;

  useEffect(() => {
    drawRef.current();
    // The frame and selection live in refs, so run.tick stands in for a new frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.run,
    props.run.tick,
    props.scrubIndex,
    props.selected,
    props.selectedOfficer,
    props.selectedVehicle,
    props.selectedBand,
    props.showVehicles,
    props.showFlow,
    props.vehicleFocus,
    props.showCoverage,
    props.dangerDensity,
    props.incidentCells,
    props.incidentLabel,
    props.hotspots,
    bundle,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let map: MapLibreMap | null = null;
    let overlay: MapboxOverlay | null = null;
    let timer: number | undefined;
    let theme = currentTheme();
    let fallback = false;
    let disconnectTheme: (() => void) | undefined;

    const setBasemap = () => {
      if (!map) return;
      const firstSymbol = map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id;
      basemapRef.current = new BitmapLayer({
        id: 'ops-basemap',
        image: basemapImage(bundle, theme),
        bounds: mapBounds(georefRef.current, bundle.width, bundle.height),
        pickable: false,
        ...(firstSymbol ? { beforeId: firstSymbol } : {}),
      } as unknown as BitmapLayerProps);
      drawRef.current();
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
      georefRef.current = fetched ?? flatGeoref(bundle.width);
      const bounds = mapBounds(georefRef.current, bundle.width, bundle.height);
      const style = configuredStyle();
      const gridOnly = fetched === null || style === '' || navigator.onLine === false;
      fallback = gridOnly;
      theme = currentTheme();
      addProtocol('pmtiles', new Protocol().tile);

      const [west, south] = bounds[0];
      const [east, north] = bounds[1];
      const padX = (east - west) * 0.2;
      const padY = (north - south) * 0.2;
      const { lon, lat } = georefRef.current.center;

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
      mapRef.current = map;
      overlay = new MapboxOverlay({ interleaved: true, layers: [] });
      overlayRef.current = overlay;
      map.addControl(overlay);
      zoomRef.current = map.getZoom();
      map.on('zoomend', () => {
        zoomRef.current = map?.getZoom() ?? zoomRef.current;
        drawRef.current();
      });

      map.once('load', () => {
        if (timer !== undefined) window.clearTimeout(timer);
        zoomRef.current = map?.getZoom() ?? zoomRef.current;
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
      mapRef.current = null;
      overlayRef.current = null;
      basemapRef.current = null;
      removeProtocol('pmtiles');
    };
  }, [bundle]);

  return <div className="ops-map" ref={hostRef} />;
}
