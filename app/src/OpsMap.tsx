import { useEffect, useRef, useState } from 'react';
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
  ColumnLayer,
  PathLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
  type BitmapLayerProps,
  type ColumnLayerProps,
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
import { bowlBox, crowdColour, seatColumns, seatedByCell, turfColumns, type SeatColumn } from './ops-3d.ts';
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
const DEFAULT_SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const DEFAULT_SATELLITE_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const STYLE_TIMEOUT_MS = 5000;
const BASEMAP_KEY = 'gd-basemap';
const THREE_D_KEY = 'gd-ops-3d';
/** Vector tiles the 3D buildings and street names are read from (OpenMapTiles schema). */
const DEFAULT_3D_TILES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const BUILDINGS_3D = 'gd-3d-buildings';
const STREET_NAMES_3D = 'gd-3d-street-names';
const OWN_3D_SOURCE = 'gd-3d';
const PITCH_3D = 58;
const BEARING_3D = -24;

const themeColour = (theme: 'light' | 'dark') => (theme === 'dark' ? '#14171a' : '#e9e7e1');

function currentTheme(): 'light' | 'dark' {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const viteEnv = () => (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

/** The configured styles. Dark falls back to the keyless OpenFreeMap Dark. */
function configuredStyles(): { light: string; dark: string } {
  const env = viteEnv();
  const value = env?.VITE_MAP_STYLE;
  return {
    light: value === undefined ? DEFAULT_STYLE : value.trim(),
    dark: env?.VITE_MAP_STYLE_DARK?.trim() || DEFAULT_DARK_STYLE,
  };
}

/** Satellite raster tiles, or '' when the deployment turned them off. */
function satelliteTiles(): string {
  const value = viteEnv()?.VITE_SATELLITE_TILES;
  return value === undefined ? DEFAULT_SATELLITE_TILES : value.trim();
}

function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    // Only used by the 3D view's street names; imagery itself has no text.
    glyphs: GLYPHS,
    sources: {
      satellite: {
        type: 'raster',
        tiles: [satelliteTiles()],
        tileSize: 256,
        maxzoom: 19,
        attribution: viteEnv()?.VITE_SATELLITE_ATTRIBUTION?.trim() || DEFAULT_SATELLITE_ATTRIBUTION,
      },
    },
    layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
  };
}

function savedSatellite(): boolean {
  try {
    return localStorage.getItem(BASEMAP_KEY) === 'satellite';
  } catch {
    return false;
  }
}

function saveSatellite(on: boolean): void {
  try {
    localStorage.setItem(BASEMAP_KEY, on ? 'satellite' : 'map');
  } catch {
    // Storage disabled: the choice lasts for this page only.
  }
}

function savedThreeD(): boolean {
  try {
    return localStorage.getItem(THREE_D_KEY) === '1';
  } catch {
    return false;
  }
}

function saveThreeD(on: boolean): void {
  try {
    localStorage.setItem(THREE_D_KEY, on ? '1' : '0');
  } catch {
    // Storage disabled: the choice lasts for this page only.
  }
}

/** Building colours for the 3D view: pale concrete by day and over imagery, slate at night. */
function buildingPaint(look: 'satellite' | 'light' | 'dark') {
  const [low, high] =
    look === 'dark' ? ['#2a3038', '#3d4651'] : look === 'satellite' ? ['#cfc9bd', '#f1ede4'] : ['#d6d1c6', '#f4f1ea'];
  return {
    'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, low, 60, high],
    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
    'fill-extrusion-opacity': look === 'satellite' ? 0.94 : 0.9,
    'fill-extrusion-vertical-gradient': true,
  };
}

function skyFor(look: 'satellite' | 'light' | 'dark') {
  return look === 'dark'
    ? {
        'sky-color': '#0b1220',
        'horizon-color': '#1c2a3f',
        'fog-color': '#141c28',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.7,
        'fog-ground-blend': 0.55,
      }
    : {
        'sky-color': '#6fa8e6',
        'horizon-color': '#dfeaf5',
        'fog-color': '#e6edf3',
        'sky-horizon-blend': 0.55,
        'horizon-fog-blend': 0.7,
        'fog-ground-blend': 0.6,
      };
}

/** The centre of a tile feature's outline, as [lon, lat]. */
function outlineCentre(geometry: { type: string; coordinates: unknown }): [number, number] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      west = Math.min(west, value[0]);
      east = Math.max(east, value[0]);
      south = Math.min(south, value[1]);
      north = Math.max(north, value[1]);
      return;
    }
    for (const item of value) walk(item);
  };
  walk(geometry.coordinates);
  return east >= west ? [(west + east) / 2, (south + north) / 2] : null;
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
  const [satellite, setSatellite] = useState(() => savedSatellite() && satelliteTiles() !== '');
  const satelliteRef = useRef(satellite);
  satelliteRef.current = satellite;
  const applyStyleRef = useRef<() => void>(() => {});
  const [threeD, setThreeD] = useState(savedThreeD);
  const threeDRef = useRef(threeD);
  threeDRef.current = threeD;
  // 3D needs real buildings, so it exists only where the map is placed on Earth and tiles can load.
  const [canThreeD, setCanThreeD] = useState(false);
  const canThreeDRef = useRef(false);
  const applyThreeDRef = useRef<(move: boolean) => void>(() => {});
  const seatsRef = useRef<SeatColumn[] | null>(null);
  // Imagery has no real-world labels and only exists where the map is placed on Earth.
  const [canSatellite, setCanSatellite] = useState(false);
  // Labels over imagery read best light on dark, whatever the app theme.
  const layerTheme = () => (satelliteRef.current && canSatellite ? 'dark' : themeRef.current);

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
        theme: layerTheme(),
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
      if (threeDRef.current && canThreeDRef.current) {
        // The bowl, one column per seat cell, with the crowd as its colour.
        seatsRef.current ??= seatColumns(bundle, georefRef.current);
        const seated = seatedByCell(bundle, view.frame);
        layers.push(
          new ColumnLayer({
            id: 'ops-bowl',
            data: seatsRef.current,
            diskResolution: 4,
            radius: georefRef.current.cellSizeM * Math.SQRT1_2,
            angle: 45,
            extruded: true,
            getPosition: (d: SeatColumn) => d.position,
            getElevation: (d: SeatColumn) => d.elevation,
            getFillColor: (d: SeatColumn) => crowdColour(d.color, seated[d.cell]!, d.cell),
            updateTriggers: { getFillColor: view.frame.t },
            material: { ambient: 0.62, diffuse: 0.5, shininess: 6 },
            pickable: false,
          } as unknown as ColumnLayerProps<SeatColumn>),
        );
        if (!(satelliteRef.current && canSatellite)) {
          layers.push(
            new ColumnLayer({
              id: 'ops-turf',
              data: turfColumns(bundle, georefRef.current),
              diskResolution: 4,
              radius: georefRef.current.cellSizeM * Math.SQRT1_2,
              angle: 45,
              extruded: true,
              getPosition: (d: SeatColumn) => d.position,
              getElevation: (d: SeatColumn) => d.elevation,
              getFillColor: (d: SeatColumn) => d.color,
              material: { ambient: 0.8, diffuse: 0.3, shininess: 2 },
              pickable: false,
            } as unknown as ColumnLayerProps<SeatColumn>),
          );
        }
      }
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
      seatsRef.current = null;
      const bounds = mapBounds(georefRef.current, bundle.width, bundle.height);
      const styles = configuredStyles();
      const gridOnly = fetched === null || styles.light === '' || navigator.onLine === false;
      const satelliteOk = fetched !== null && satelliteTiles() !== '' && navigator.onLine !== false;
      setCanSatellite(satelliteOk);
      const threeDOk = fetched !== null && navigator.onLine !== false && (styles.light !== '' || satelliteOk);
      canThreeDRef.current = threeDOk;
      setCanThreeD(threeDOk);
      const satelliteOn = () => satelliteOk && satelliteRef.current;
      fallback = gridOnly && !satelliteOn();
      theme = currentTheme();
      themeRef.current = theme;
      const initialStyle = satelliteOn()
        ? satelliteStyle()
        : gridOnly
          ? blankStyle(theme)
          : styleForTheme(theme, styles);
      // What is on the map now: a style URL, 'satellite' or 'blank'.
      let currentStyle = satelliteOn() ? 'satellite' : gridOnly ? 'blank' : styleForTheme(theme, styles);
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
        maxPitch: 75,
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
      (
        window as unknown as {
          gamedayMap?: {
            lookAt(xM: number, yM: number, zoom: number): void;
            camera(xM: number, yM: number, zoom: number, bearing: number, pitch: number, ms: number): void;
          };
        }
      ).gamedayMap = {
        lookAt: (xM, yM, zoom) => {
          map?.jumpTo({
            center: metresToLngLat(georefRef.current, bundle.width, xM, yM),
            zoom,
          });
        },
        // A timed camera move, for unattended checks and recordings of the 3D view.
        camera: (xM, yM, zoom, bearing, pitch, ms) => {
          map?.easeTo({
            center: metresToLngLat(georefRef.current, bundle.width, xM, yM),
            zoom,
            bearing,
            pitch,
            duration: ms,
            easing: (t) => t,
          });
        },
      };
      map.on('zoomend', () => {
        zoomRef.current = map?.getZoom() ?? zoomRef.current;
        drawRef.current();
      });

      // 3D: tilt the camera, raise the buildings from the tiles' own heights, name the
      // streets over imagery and put a sky behind it. A new style drops added layers,
      // so this runs again on every style load.
      const box = bowlBox(bundle);
      let hidden = '';
      const hideStadium = () => {
        if (!map || !box || !map.getLayer(BUILDINGS_3D)) return;
        const source = map.getLayer(BUILDINGS_3D)!.source;
        const ids = new Set<number>();
        for (const feature of map.querySourceFeatures(source, { sourceLayer: 'building' })) {
          if (typeof feature.id !== 'number') continue;
          const centre = outlineCentre(feature.geometry as { type: string; coordinates: unknown });
          if (!centre) continue;
          const cell = lngLatToCell(georefRef.current, bundle.width, bundle.height, centre[0], centre[1]);
          if (cell < 0) continue;
          const u = cell % bundle.width;
          const v = Math.floor(cell / bundle.width);
          if (u >= box.x0 && u <= box.x1 && v >= box.y0 && v <= box.y1) ids.add(feature.id);
        }
        const key = [...ids].sort().join(',');
        if (key === hidden) return;
        hidden = key;
        // The tile's stadium is one solid block; the tiered bowl is drawn in its place.
        map.setFilter(BUILDINGS_3D, ids.size ? ['!', ['in', ['id'], ['literal', [...ids]]]] : null);
      };
      const applyThreeD = (move: boolean) => {
        if (!map) return;
        const on = threeDOk && threeDRef.current && !fallback;
        const look = currentStyle === 'satellite' ? 'satellite' : theme;
        try {
          if (map.getLayer(STREET_NAMES_3D)) map.removeLayer(STREET_NAMES_3D);
          if (map.getLayer(BUILDINGS_3D)) map.removeLayer(BUILDINGS_3D);
          hidden = '';
          if (on) {
            const source = map.getSource('openmaptiles') ? 'openmaptiles' : OWN_3D_SOURCE;
            if (!map.getSource(source)) {
              map.addSource(source, { type: 'vector', url: viteEnv()?.VITE_3D_TILES?.trim() || DEFAULT_3D_TILES });
            }
            map.addLayer({
              id: BUILDINGS_3D,
              type: 'fill-extrusion',
              source,
              'source-layer': 'building',
              minzoom: 13,
              paint: buildingPaint(look),
            } as never);
            if (look === 'satellite') {
              map.addLayer({
                id: STREET_NAMES_3D,
                type: 'symbol',
                source,
                'source-layer': 'transportation_name',
                minzoom: 14,
                layout: {
                  'symbol-placement': 'line',
                  'text-field': ['get', 'name'],
                  'text-font': ['Noto Sans Regular'],
                  'text-size': 12,
                  'text-letter-spacing': 0.04,
                },
                paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.4 },
              } as never);
            }
            map.setSky(skyFor(look) as never);
            map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.35, position: [1.4, 215, 35] });
            hideStadium();
          }
        } catch {
          // The style is mid-change; the next style load applies it.
        }
        if (move) map.easeTo({ pitch: on ? PITCH_3D : 0, bearing: on ? BEARING_3D : 0, duration: 900 });
        else if (on && map.getPitch() === 0) map.jumpTo({ pitch: PITCH_3D, bearing: BEARING_3D });
        drawRef.current();
      };
      applyThreeDRef.current = applyThreeD;
      map.on('style.load', () => applyThreeD(false));
      map.on('idle', () => {
        if (threeDRef.current) hideStadium();
      });

      map.once('load', () => {
        if (timer !== undefined) window.clearTimeout(timer);
        zoomRef.current = map?.getZoom() ?? zoomRef.current;
        setBasemap();
      });

      if (!gridOnly && !satelliteOn()) timer = window.setTimeout(() => fallbackToGrid(), STYLE_TIMEOUT_MS);
      else setBasemap();

      applyStyleRef.current = () => {
        if (!map) return;
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        if (satelliteOn()) {
          if (currentStyle === 'satellite') return;
          fallback = false;
          currentStyle = 'satellite';
          map.setStyle(satelliteStyle());
        } else if (gridOnly) {
          if (currentStyle === 'blank') return;
          fallback = true;
          currentStyle = 'blank';
          map.setStyle(blankStyle(theme));
        } else {
          const next = styleForTheme(theme, styles);
          if (currentStyle === next) return;
          fallback = false;
          currentStyle = next;
          map.setStyle(next);
          timer = window.setTimeout(() => fallbackToGrid(), STYLE_TIMEOUT_MS);
          map.once('styledata', () => {
            if (timer !== undefined) window.clearTimeout(timer);
            timer = undefined;
          });
        }
        setBasemap();
      };

      const setTheme = () => {
        const next = currentTheme();
        if (next === theme) return;
        theme = next;
        themeRef.current = next;
        if (currentStyle === 'satellite') {
          drawRef.current();
          return;
        }
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
      applyStyleRef.current = () => {};
      applyThreeDRef.current = () => {};
      seatsRef.current = null;
      delete (window as unknown as { gamedayMap?: unknown }).gamedayMap;
      removeProtocol('pmtiles');
    };
  }, [bundle]);

  useEffect(() => {
    saveSatellite(satellite);
    applyStyleRef.current();
    drawRef.current();
  }, [satellite]);

  useEffect(() => {
    saveThreeD(threeD);
    applyThreeDRef.current(true);
  }, [threeD]);

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
        {canThreeD && (
          <button
            title={threeD ? 'Look straight down again' : 'Tilt the map: 3D buildings and the stadium bowl'}
            aria-pressed={threeD}
            onClick={() => {
              // 3D reads best over imagery, so turning it on brings the imagery with it.
              if (!threeD && canSatellite) setSatellite(true);
              setThreeD((on) => !on);
            }}
          >
            {threeD ? 'Flat' : '3D'}
          </button>
        )}
        {canSatellite && (
          <button
            title={satellite ? 'Show the street map' : 'Show satellite imagery'}
            aria-pressed={satellite}
            onClick={() => setSatellite((on) => !on)}
          >
            {satellite ? 'Map' : 'Satellite'}
          </button>
        )}
      </div>
    </div>
  );
}
