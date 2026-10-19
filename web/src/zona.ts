// Cálculos de la zona seleccionada (círculo alrededor de un punto o polígono dibujado).
// Funciones puras: se prueban en zona.test.ts.
import circle from "@turf/circle";
import booleanIntersects from "@turf/boolean-intersects";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import bbox from "@turf/bbox";
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
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

/** Una zona: su forma (para dibujar e intersectar) y una prueba rápida de "¿este punto está adentro?". */
export interface Zona {
  forma: Feature<Polygon>;
  caja: [number, number, number, number];
  contiene: (p: [number, number]) => boolean;
}

export function zonaCirculo(centro: [number, number], radioKm: number): Zona {
  const forma = circuloZona(centro, radioKm);
  return { forma, caja: bbox(forma) as [number, number, number, number], contiene: (p) => distanciaKm(centro, p) <= radioKm };
}

export function zonaPoligono(forma: Feature<Polygon>): Zona {
  const caja = bbox(forma) as [number, number, number, number];
  return {
    forma,
    caja,
    contiene: (p) => p[0] >= caja[0] && p[0] <= caja[2] && p[1] >= caja[1] && p[1] <= caja[3] && booleanPointInPolygon(p, forma),
  };
}

/** Superficie aproximada de la zona en km² (para mostrarla en la ficha). */
export function areaKm2(forma: Feature<Polygon>): number {
  const anillo = forma.geometry.coordinates[0];
  const lat0 = (anillo.reduce((s, c) => s + c[1], 0) / anillo.length) * (Math.PI / 180);
  const kx = 111.32 * Math.cos(lat0);
  const ky = 110.57;
  let a = 0;
  for (let i = 0; i < anillo.length - 1; i++) {
    a += anillo[i][0] * kx * (anillo[i + 1][1] * ky) - anillo[i + 1][0] * kx * (anillo[i][1] * ky);
  }
  return Math.abs(a / 2);
}

/** Distritos que toca la zona (primero filtra por caja envolvente para ir rápido en el celular). */
export function distritosEnZona(distritos: FeatureCollection, zona: Zona): Distrito[] {
  const [o, s, e, n] = zona.caja;
  const out: Distrito[] = [];
  for (const f of distritos.features as Distrito[]) {
    const [fo, fs, fe, fn] = (f.bbox as number[] | undefined) ?? (f.bbox = bbox(f));
    if (fe < o || fo > e || fn < s || fs > n) continue;
    if (booleanIntersects(zona.forma, f)) out.push(f);
  }
  return out;
}

export interface ResultadoZona {
  distritos: Distrito[];
  puntuales: Noticia[]; // pin dentro de la zona
  amplias: Noticia[]; // a nivel provincia o región que contiene parte de la zona
}

export function noticiasEnZona(noticias: Noticia[], distritos: FeatureCollection, zona: Zona): ResultadoZona {
  const tocados = distritosEnZona(distritos, zona);
  const provincias = new Set(tocados.map((d) => d.properties.ubigeo.slice(0, 4)));
  const deptos = new Set(tocados.map((d) => d.properties.ubigeo.slice(0, 2)));
  const puntuales: Noticia[] = [];
  const amplias: Noticia[] = [];
  for (const n of noticias) {
    const l = lugarPrincipal(n);
    if (!l) continue;
    if (esPuntual(l)) {
      if (zona.contiene([l.lon, l.lat])) puntuales.push(n);
    } else if (l.precision === "provincia" ? provincias.has(l.ubigeo.slice(0, 4)) : deptos.has(l.ubigeo.slice(0, 2))) {
      amplias.push(n);
    }
  }
  const porFecha = (a: Noticia, b: Noticia) => b.fecha.localeCompare(a.fecha);
  return { distritos: tocados, puntuales: puntuales.sort(porFecha), amplias: amplias.sort(porFecha) };
}

/** Puntos de una capa (establecimientos, conflictos) dentro de la zona. */
export function puntosEnZona<P>(fc: FeatureCollection<Point, P>, zona: Zona): Feature<Point, P>[] {
  return fc.features.filter((f) => zona.contiene(f.geometry.coordinates as [number, number]));
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

/** Resumen de pobreza (punto medio del intervalo INEI) de los distritos de la zona. */
export function resumenPobreza(ubigeos: string[], pobreza: Record<string, number[]>) {
  const valores = ubigeos.map((u) => pobreza[u]).filter(Boolean);
  if (!valores.length) return null;
  const medios = valores.map((v) => v[2]);
  return {
    conDato: valores.length,
    sinDato: ubigeos.length - valores.length,
    minimo: Math.min(...medios),
    maximo: Math.max(...medios),
    inferior: Math.min(...valores.map((v) => v[0])),
    superior: Math.max(...valores.map((v) => v[1])),
  };
}
