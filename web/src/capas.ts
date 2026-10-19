// Capas de datos públicos: se cargan solo cuando el usuario las prende (carga diferida para el celular).
import { addProtocol, type GeoJSONSource, type Map as MapaLibre } from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { FeatureCollection, Point } from "geojson";

export interface Meta {
  capa: string;
  fuente: string;
  url: string;
  fecha_corte: string;
  fecha_carga: string;
  registros: number;
  notas: string;
  estilo: Record<string, unknown>;
}

export type IdCapa = "pobreza" | "conflictos" | "concesiones" | "salud" | "calor";

export interface PropsConflicto {
  codigo: string; tipo: string; caso: string; ubicacion: string; dialogo: string | null;
  lugar: string; precision: string; ubigeo: string; provincia: string; departamento: string; distritos: string[];
}
export interface PropsSalud { n: string; c: string; t: string; i: string; u: string; p: 0 | 1 }

/** Datos cargados (se llenan a medida que el usuario prende capas o abre fichas). */
export const datos: {
  meta: Partial<Record<string, Meta>>;
  pobreza?: Record<string, number[]>;
  conflictos?: FeatureCollection<Point, PropsConflicto>;
  salud?: FeatureCollection<Point, PropsSalud>;
  concesionesCentros?: [number, number, number][];
  concesionesDistritos?: Record<string, [number, number]>;
  concesionesDisponibles?: boolean;
} = { meta: {} };

const cargando = new Map<string, Promise<unknown>>();

async function json<T>(ruta: string): Promise<T> {
  const r = await fetch(ruta, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** Carga una vez (aunque se pida varias veces a la vez). */
export function cargarUnaVez<T>(clave: string, f: () => Promise<T>): Promise<T> {
  if (!cargando.has(clave)) cargando.set(clave, f().catch((e) => { cargando.delete(clave); throw e; }));
  return cargando.get(clave) as Promise<T>;
}

export async function cargarMetas() {
  await Promise.all(
    ["pobreza", "conflictos", "concesiones", "salud", "distritos"].map(async (c) => {
      datos.meta[c] = await json<Meta>(`data/layers/${c}.meta.json`).catch(() => undefined);
    }),
  );
}

export const cargar = {
  pobreza: () => cargarUnaVez("pobreza", async () => {
    const d = await json<Record<string, number[]>>("data/layers/pobreza.json");
    datos.pobreza = d;
    return d;
  }),
  conflictos: () => cargarUnaVez("conflictos", async () => {
    const d = await json<FeatureCollection<Point, PropsConflicto>>("data/layers/conflictos.geojson");
    datos.conflictos = d;
    return d;
  }),
  salud: () => cargarUnaVez("salud", async () => {
    const d = await json<FeatureCollection<Point, PropsSalud>>("data/layers/salud.geojson");
    datos.salud = d;
    return d;
  }),
  concesionesResumen: () =>
    cargarUnaVez("concesiones-resumen", async () => {
      [datos.concesionesCentros, datos.concesionesDistritos] = await Promise.all([
        json<[number, number, number][]>("data/layers/concesiones_centros.json"),
        json<Record<string, [number, number]>>("data/layers/concesiones_distritos.json"),
      ]);
    }),
};

// ---------- Estilos ----------
export const COLORES_POBREZA = ["#fff7bc", "#fec44f", "#fe9929", "#d95f0e", "#993404"]; // ColorBrewer YlOrBr (apto daltónicos)
export const COLOR_CONFLICTO = "#111827";
export const COLOR_CONCESION = "#7c3aed";
export const COLOR_SALUD_PUBLICO = "#be185d";
export const COLOR_SALUD_PRIVADO = "#9ca3af";

export function cortesPobreza(): number[] {
  return (datos.meta.pobreza?.estilo?.cortes as number[] | undefined) ?? [18.3, 29.1, 39.2, 49.5];
}

let protocoloListo = false;

/** Agrega al mapa (una sola vez) la fuente y las capas de `id`, ocultas. Devuelve false si no hay datos. */
export async function prepararCapa(mapa: MapaLibre, id: IdCapa, debajoDe: string): Promise<boolean> {
  if (id === "pobreza") {
    const pob = await cargar.pobreza();
    if (!mapa.getLayer("pobreza-relleno")) {
      for (const [ub, v] of Object.entries(pob)) mapa.setFeatureState({ source: "distritos", id: ub }, { pob: v[2] });
      const c = cortesPobreza();
      mapa.addLayer({
        id: "pobreza-relleno", type: "fill", source: "distritos", layout: { visibility: "none" },
        paint: {
          "fill-color": ["case", ["==", ["feature-state", "pob"], null], "#e5e7eb",
            ["step", ["feature-state", "pob"], COLORES_POBREZA[0], c[0], COLORES_POBREZA[1], c[1], COLORES_POBREZA[2], c[2], COLORES_POBREZA[3], c[3], COLORES_POBREZA[4]]],
          "fill-opacity": 0.75,
        },
      }, debajoDe);
    }
    return true;
  }
  if (id === "conflictos") {
    const fc = await cargar.conflictos();
    if (!mapa.getSource("conflictos")) {
      mapa.addSource("conflictos", { type: "geojson", data: fc });
      mapa.addLayer({
        id: "conflictos-punto", type: "circle", source: "conflictos", layout: { visibility: "none" },
        paint: {
          "circle-color": "#fde68a", "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 6, 10, 9],
          "circle-stroke-color": COLOR_CONFLICTO, "circle-stroke-width": 3,
        },
      });
    }
    return true;
  }
  if (id === "salud") {
    const fc = await cargar.salud();
    if (!mapa.getSource("salud")) {
      mapa.addSource("salud", { type: "geojson", data: fc, cluster: true, clusterRadius: 45, clusterMaxZoom: 12 });
      mapa.addLayer({
        id: "salud-grupo", type: "circle", source: "salud", filter: ["has", "point_count"], layout: { visibility: "none" },
        paint: {
          "circle-color": "#fce7f3", "circle-stroke-color": COLOR_SALUD_PUBLICO, "circle-stroke-width": 1.5,
          "circle-radius": ["step", ["get", "point_count"], 11, 50, 15, 500, 20],
        },
      }, debajoDe);
      mapa.addLayer({
        id: "salud-grupo-n", type: "symbol", source: "salud", filter: ["has", "point_count"],
        layout: { visibility: "none", "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 11 },
        paint: { "text-color": "#831843" },
      }, debajoDe);
      mapa.addLayer({
        id: "salud-punto", type: "circle", source: "salud", filter: ["!", ["has", "point_count"]], layout: { visibility: "none" },
        paint: {
          "circle-color": ["case", ["==", ["get", "p"], 1], COLOR_SALUD_PUBLICO, COLOR_SALUD_PRIVADO],
          "circle-radius": 4.5, "circle-stroke-color": "#fff", "circle-stroke-width": 1,
        },
      }, debajoDe);
    }
    return true;
  }
  if (id === "concesiones") {
    if (datos.concesionesDisponibles === undefined) {
      const r = await fetch("data/layers/concesiones.pmtiles", { method: "HEAD" }).catch(() => null);
      datos.concesionesDisponibles = !!r && r.ok;
    }
    if (!datos.concesionesDisponibles) return false;
    if (!protocoloListo) {
      addProtocol("pmtiles", new Protocol().tile);
      protocoloListo = true;
    }
    if (!mapa.getSource("concesiones")) {
      const url = new URL("data/layers/concesiones.pmtiles", document.baseURI).href;
      mapa.addSource("concesiones", { type: "vector", url: `pmtiles://${url}`, attribution: "INGEMMET" });
      mapa.addLayer({
        id: "concesiones-relleno", type: "fill", source: "concesiones", "source-layer": "concesiones", layout: { visibility: "none" },
        paint: { "fill-color": ["match", ["get", "estado"], "Titulada", COLOR_CONCESION, "#a78bfa"], "fill-opacity": 0.28 },
      }, debajoDe);
      mapa.addLayer({
        id: "concesiones-borde", type: "line", source: "concesiones", "source-layer": "concesiones", minzoom: 8,
        layout: { visibility: "none" }, paint: { "line-color": COLOR_CONCESION, "line-width": 0.6, "line-opacity": 0.7 },
      }, debajoDe);
    }
    return true;
  }
  if (id === "calor") {
    if (!mapa.getSource("noticias-calor")) {
      mapa.addSource("noticias-calor", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      mapa.addLayer({
        id: "noticias-calor", type: "heatmap", source: "noticias-calor", maxzoom: 12, layout: { visibility: "none" },
        paint: {
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 14, 10, 30],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 10, 1.6],
          "heatmap-opacity": 0.75,
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(255,255,255,0)", 0.2, "#fde68a", 0.45, "#fb923c", 0.7, "#dc2626", 1, "#7f1d1d"],
        },
      }, debajoDe);
    }
    return true;
  }
  return false;
}

export const CAPAS_MAPA: Record<IdCapa, string[]> = {
  pobreza: ["pobreza-relleno"],
  conflictos: ["conflictos-punto"],
  concesiones: ["concesiones-relleno", "concesiones-borde"],
  salud: ["salud-grupo", "salud-grupo-n", "salud-punto"],
  calor: ["noticias-calor"],
};

export function mostrarCapa(mapa: MapaLibre, id: IdCapa, visible: boolean) {
  for (const l of CAPAS_MAPA[id]) if (mapa.getLayer(l)) mapa.setLayoutProperty(l, "visibility", visible ? "visible" : "none");
}

export function actualizarCalor(mapa: MapaLibre, fc: FeatureCollection) {
  (mapa.getSource("noticias-calor") as GeoJSONSource | undefined)?.setData(fc);
}
