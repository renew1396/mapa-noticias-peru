// Cálculos de la zona seleccionada (radio alrededor de un punto). Funciones puras: se prueban en zona.test.ts.
import circle from "@turf/circle";
import booleanIntersects from "@turf/boolean-intersects";
import bbox from "@turf/bbox";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Lugar, Noticia } from "./tipos";

export type Distrito = Feature<Polygon | MultiPolygon, { ubigeo: string; distrito: string; provincia: string; departamento: string }>;

const R_TIERRA_KM = 6371.0088;

/** Distancia en km entre dos puntos [lon, lat] (fórmula de haversine). */
export function distanciaKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lugarPrincipal(n: Noticia): Lugar | undefined {
  return n.lugares.find((l) => l.principal);
}

/** Noticias con lugar puntual (distrito o centro poblado) se ubican con pin; las de provincia o región no. */
export function esPuntual(l: Lugar | undefined): l is Lugar & { precision: "distrito" | "centro_poblado" } {
  return !!l && (l.precision === "distrito" || l.precision === "centro_poblado");
}

export function circuloZona(centro: [number, number], radioKm: number) {
  return circle(centro, radioKm, { steps: 64, units: "kilometers" });
}

/** Distritos que toca el círculo (primero filtra por caja envolvente para ir rápido en el celular). */
export function distritosEnZona(distritos: FeatureCollection, centro: [number, number], radioKm: number): Distrito[] {
  const c = circuloZona(centro, radioKm);
  const [o, s, e, n] = bbox(c);
  const out: Distrito[] = [];
  for (const f of distritos.features as Distrito[]) {
    const [fo, fs, fe, fn] = (f.bbox as number[] | undefined) ?? bbox(f);
    if (fe < o || fo > e || fn < s || fs > n) continue;
    if (booleanIntersects(c, f)) out.push(f);
  }
  return out;
}

export interface ResultadoZona {
  distritos: Distrito[];
  puntuales: Noticia[]; // pin dentro del círculo
  amplias: Noticia[]; // a nivel provincia o región que contiene parte de la zona
}

export function noticiasEnZona(
  noticias: Noticia[],
  distritos: FeatureCollection,
  centro: [number, number],
  radioKm: number,
): ResultadoZona {
  const tocados = distritosEnZona(distritos, centro, radioKm);
  const provincias = new Set(tocados.map((d) => d.properties.ubigeo.slice(0, 4)));
  const deptos = new Set(tocados.map((d) => d.properties.ubigeo.slice(0, 2)));
  const puntuales: Noticia[] = [];
  const amplias: Noticia[] = [];
  for (const n of noticias) {
    const l = lugarPrincipal(n);
    if (!l) continue;
    if (esPuntual(l)) {
      if (distanciaKm(centro, [l.lon, l.lat]) <= radioKm) puntuales.push(n);
    } else if (l.precision === "provincia" ? provincias.has(l.ubigeo.slice(0, 4)) : deptos.has(l.ubigeo.slice(0, 2))) {
      amplias.push(n);
    }
  }
  const porFecha = (a: Noticia, b: Noticia) => b.fecha.localeCompare(a.fecha);
  return { distritos: tocados, puntuales: puntuales.sort(porFecha), amplias: amplias.sort(porFecha) };
}

export interface Filtros {
  dias: number;
  tema: string; // "" = todos
  medio: string; // "" = todos
}

export function filtrar(noticias: Noticia[], f: Filtros, ahora = Date.now()): Noticia[] {
  const desde = ahora - f.dias * 86_400_000;
  return noticias.filter(
    (n) =>
      Date.parse(n.fecha) >= desde && (!f.tema || n.temas[0] === f.tema || n.temas.includes(f.tema)) && (!f.medio || n.medio === f.medio),
  );
}
