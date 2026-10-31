import { useEffect, useRef } from 'react';
import {
  addProtocol,
  Map as MapLibreMap,
  removeProtocol,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
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
import { flatGeoref, lngLatToCell, mapBounds, metresToLngLat } from './ops-geo.ts';
import {
  opsLayerProps,
  type FanRow,
  type OfficerRow,
  type OpsLayerProps,
  type PathDatum,
  type PointDatum,
  type PolygonDatum,
  type TextDatum,
  type VehicleRow,
} from './ops-layers.ts';
import { streetPickAt } from './street-pick.ts';
import { cellCentreLngLat } from '../../world/src/osm/georef.ts';
import type { MapGeoref } from '../../world/src/osm/georef.ts';

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const DEFAULT_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const STYLE_TIMEOUT_MS = 5000;

const themeColour = (theme: 'light' | 'dark') => (theme === 'dark' ? '#14171a' : '#e9e7e1');

function currentTheme(): 'light' | 'dark' {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The configured styles. Dark falls back to the keyless OpenFreeMap Dark. */
function configuredStyles(): { light: string; dark: string } {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const value = env?.VITE_MAP_STYLE;
  return {
    light: value === undefined ? DEFAULT_STYLE : value.trim(),
    dark: env?.VITE_MAP_STYLE_DARK?.trim() || DEFAULT_DARK_STYLE,
  };
}

function styleForTheme(theme: 'light' | 'dark', styles: { light: string; dark: string }): string {
  return theme === 'dark' ? styles.dark : styles.light;
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
      ...specs.unitLabels,
      fontFamily: 'system-ui, sans-serif',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
    } as unknown as TextLayerProps<TextDatum>),
    new TextLayer({
      ...specs.gates,
      fontFamily: 'system-ui, sans-serif',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
    } as unknown as TextLayerProps<TextDatum>),
    new TextLayer({
      ...specs.incidentText,
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
  const themeRef = useRef<'light' | 'dark'>(currentTheme());
  const drawRef = useRef<() => void>(() => {});
  const clickRef = useRef<(event: MapMouseEvent) => void>(() => {});

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
        theme: themeRef.current,
        dangerDensity: props.dangerDensity,
        selectedBand: props.selectedBand,
        showVehicles: props.showVehicles,
        showFlow: props.showFlow,
        vehicleFocus: props.vehicleFocus,
        selectedVehicle: props.selectedVehicle,
        selectedOfficer: props.selectedOfficer,
        selected: props.selected,
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

  const fitCellBounds = (x0: number, y0: number, x1: number, y1: number) => {
    const map = mapRef.current;
    if (!map) return;
    const [west, north] = cellCentreLngLat(georefRef.current, bundle.width, x0 - 0.5, y0 - 0.5);
    const [east, south] = cellCentreLngLat(georefRef.current, bundle.width, x1 + 0.5, y1 + 0.5);
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 40, maxZoom: 18, duration: 0 },
    );
  };

  const fitCells = (cells: number[] | undefined) => {
    if (!cells || cells.length === 0) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const cell of cells) {
      const x = cell % bundle.width;
      const y = Math.floor(cell / bundle.width);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    fitCellBounds(x0, y0, x1, y1);
  };

  const fitWhole = () => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(mapBounds(georefRef.current, bundle.width, bundle.height), {
      padding: 24,
      maxZoom: 18,
      duration: 0,
    });
  };

  const focusSelected = () => {
    const map = mapRef.current;
    if (!map || props.selected === null) return;
    const kept = props.run.frames.current ?? [];
    const view =
      props.scrubIndex === null ? props.run.latest.current : kept[Math.min(props.scrubIndex, kept.length - 1)];
    const frame = view?.frame;
    if (!frame) return;
    const x = frame.x[props.selected];
    const y = frame.y[props.selected];
    if (x === undefined || y === undefined || x < 0 || y < 0) return;
    const centre = metresToLngLat(georefRef.current, bundle.width, x, y);
    map.easeTo({ center: centre, zoom: Math.max(map.getZoom(), 17.5), duration: 400 });
  };

  useEffect(() => {
    if (props.focusBox) fitCellBounds(props.focusBox.x0, props.focusBox.y0, props.focusBox.x1, props.focusBox.y1);
    // fitCellBounds is recreated with props; the nonce is what means "go there".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusBox]);

  useEffect(() => {
    if (props.focusToken > 0) focusSelected();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusToken]);

  clickRef.current = (event) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const cell = lngLatToCell(georefRef.current, bundle.width, bundle.height, event.lngLat.lng, event.lngLat.lat);
    // A police order waiting for a click takes it outright, as in the close-up.
    if (props.onPickStreet) {
      if (cell >= 0) {
        const street = streetPickAt(bundle, cell);
        if (street >= 0) props.onPickStreet(street);
      }
      return;
    }
    const pick = (layerId: string) =>
      overlay.pickObject({ x: event.point.x, y: event.point.y, radius: 5, layerIds: [layerId] });
    const officer = pick('ops-officers');
    if (officer?.object) {
      props.onPickOfficer((officer.object as OfficerRow).id);
      return;
    }
    const vehicle = pick('ops-vehicles');
    if (vehicle?.object) {
      props.onPickVehicle((vehicle.object as VehicleRow).vehicle);
      return;
    }
    const fan = pick('ops-fans');
    if (fan?.object) {
      props.onPick((fan.object as FanRow).dot);
      return;
    }
    props.onPick(null);
  };

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
      if (!map || !fallback) {
        basemapRef.current = null;
        drawRef.current();
        return;
      }
      const firstSymbol = map.getStyle()?.layers?.find((layer) => layer.type === 'symbol')?.id;
      const [[west, south], [east, north]] = mapBounds(georefRef.current, bundle.width, bundle.height);
      basemapRef.current = new BitmapLayer({
        id: 'ops-basemap',
        image: basemapImage(bundle, theme),
        bounds: [west, south, east, north],
        opacity: 1,
        pickable: false,
        ...(firstSymbol ? { beforeId: firstSymbol } : {}),
      } as unknown as BitmapLayerProps);
      drawRef.current();
    };

    const fallbackToGrid = () => {
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
      const styles = configuredStyles();
      const gridOnly = fetched === null || styles.light === '' || navigator.onLine === false;
      fallback = gridOnly;
      theme = currentTheme();
      themeRef.current = theme;
      const initialStyle = gridOnly ? blankStyle(theme) : styleForTheme(theme, styles);
      let currentStyle = initialStyle;
      addProtocol('pmtiles', new Protocol().tile);

      const [west, south] = bounds[0];
      const [east, north] = bounds[1];
      const padX = (east - west) * 0.2;
      const padY = (north - south) * 0.2;
      const { lon, lat } = georefRef.current.center;

      map = new MapLibreMap({
        container: host,
        style: initialStyle,
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
      map.on('click', (event) => clickRef.current(event));
      zoomRef.current = map.getZoom();
      (window as unknown as { gamedayMap?: { lookAt(xM: number, yM: number, zoom: number): void } }).gamedayMap = {
        lookAt: (xM, yM, zoom) => {
          map?.jumpTo({
            center: metresToLngLat(georefRef.current, bundle.width, xM, yM),
            zoom,
          });
        },
      };
      map.on('zoomend', () => {
        zoomRef.current = map?.getZoom() ?? zoomRef.current;
        drawRef.current();
      });

      map.once('load', () => {
        if (timer !== undefined) window.clearTimeout(timer);
        zoomRef.current = map?.getZoom() ?? zoomRef.current;
        setBasemap();
      });

      if (!gridOnly) timer = window.setTimeout(() => fallbackToGrid(), STYLE_TIMEOUT_MS);
      else setBasemap();

      const setTheme = () => {
        const next = currentTheme();
        if (next === theme) return;
        theme = next;
        themeRef.current = next;
        if (fallback) {
          map?.setPaintProperty('bg', 'background-color', themeColour(theme));
          setBasemap();
          drawRef.current();
          return;
        }
        const nextStyle = styleForTheme(theme, styles);
        if (nextStyle && nextStyle !== currentStyle) {
          currentStyle = nextStyle;
          map?.setStyle(nextStyle);
        }
        drawRef.current();
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
      delete (window as unknown as { gamedayMap?: unknown }).gamedayMap;
      removeProtocol('pmtiles');
    };
  }, [bundle]);

  return (
    <div className="ops-map-wrap">
      <div className="ops-map" ref={hostRef} />
      <div className="ops-tools">
        <button title="Show the whole map" onClick={fitWhole}>
          Whole map
        </button>
        <button
          title="Back to the incident"
          onClick={() => fitCells(props.incidentCells)}
          disabled={!props.incidentCells || props.incidentCells.length === 0}
        >
          Incident
        </button>
      </div>
    </div>
  );
}
