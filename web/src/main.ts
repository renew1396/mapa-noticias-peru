import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import {
  Map as MapaLibre, NavigationControl, GeolocateControl, AttributionControl, setWorkerUrl,
  type GeoJSONSource, type MapGeoJSONFeature, type MapMouseEvent,
} from "maplibre-gl";
// Vite no detecta solo el worker de MapLibre 6: lo empaquetamos y le pasamos su URL.
import urlWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Feature, FeatureCollection, Point } from "geojson";
import type { Estado, IndiceNoticias, Noticia, Tema } from "./tipos";
import { circuloZona, esPuntual, filtrar, lugarPrincipal, noticiasEnZona, type Filtros } from "./zona";
import { escapar, fichaLugar, fichaZona, haceCuanto } from "./ui";

setWorkerUrl(urlWorker);

// Mapa base gratuito y sin clave (ver DECISIONS.md › Mapa base).
const ESTILO_BASE = "https://tiles.openfreemap.org/styles/positron";
const LIMITES_PERU: [number, number, number, number] = [-81.4, -18.4, -68.6, 0.1];
const COLOR_ACENTO = "#c2410c";

const ES = {
  "NavigationControl.ZoomIn": "Acercar",
  "NavigationControl.ZoomOut": "Alejar",
  "NavigationControl.ResetBearing": "Orientar al norte",
  "GeolocateControl.FindMyLocation": "Mi ubicación",
  "GeolocateControl.LocationNotAvailable": "Ubicación no disponible",
  "AttributionControl.ToggleAttribution": "Créditos del mapa",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const estadoEl = $("estado");
const ficha = $("ficha");
const fichaContenido = $("ficha-contenido");
const panelFiltros = $("filtros");
const botonFiltros = $("abrir-filtros");

// ---------- Estado de la aplicación ----------
const filtros: Filtros = { dias: 7, tema: "", medio: "" };
let indice: IndiceNoticias = { actualizado: "", dias: [] };
const diasCargados = new Map<string, Noticia[]>();
let todas: Noticia[] = [];
let visibles: Noticia[] = [];
let distritos: FeatureCollection = { type: "FeatureCollection", features: [] };
let temas = new Map<string, Tema>();
let zona: { centro: [number, number]; radio: number; lugar: string } | null = null;
let distritosConNoticias = new Set<string>();

async function cargarJSON<T>(ruta: string): Promise<T> {
  const r = await fetch(ruta, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

function mostrarError(texto: string) {
  const div = document.createElement("div");
  div.className = "error";
  div.textContent = texto;
  $("mapa").appendChild(div);
}

/** Carga (una sola vez) los archivos diarios que cubren el período elegido. */
async function cargarDias(dias: number) {
  const limite = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);
  const pendientes = indice.dias.filter((d) => d.fecha >= limite && !diasCargados.has(d.fecha));
  await Promise.all(
    pendientes.map(async (d) => {
      try {
        const j = await cargarJSON<{ noticias: Noticia[] }>(`data/news/${d.fecha}.json`);
        diasCargados.set(d.fecha, j.noticias);
      } catch (e) {
        console.error(e);
        diasCargados.set(d.fecha, []);
      }
    }),
  );
  todas = [...diasCargados.values()].flat();
}

// ---------- Mapa ----------
const mapa = new MapaLibre({
  container: "mapa",
  style: ESTILO_BASE,
  bounds: LIMITES_PERU,
  fitBoundsOptions: { padding: 12 },
  maxBounds: [-90, -25, -60, 6],
  locale: ES,
  attributionControl: false,
});
mapa.addControl(new AttributionControl({ compact: true }), "bottom-right");
mapa.addControl(new NavigationControl({ showCompass: false }), "top-right");
mapa.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");
mapa.on("error", (e) => console.error("Error del mapa:", e.error));

// Etiquetas del mapa base en español: nombre en español si existe, si no el nombre local.
function etiquetasEnEspanol() {
  for (const capa of mapa.getStyle().layers) {
    if (capa.type === "symbol" && mapa.getLayoutProperty(capa.id, "text-field")) {
      mapa.setLayoutProperty(capa.id, "text-field", ["coalesce", ["get", "name:es"], ["get", "name"]]);
    }
  }
}

function geojsonNoticias(): FeatureCollection<Point> {
  // Un pin por noticia con lugar puntual (distrito o centro poblado).
  const feats: Feature<Point>[] = [];
  for (const n of visibles) {
    const l = lugarPrincipal(n);
    if (!esPuntual(l)) continue;
    feats.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [l.lon, l.lat] },
      properties: { id: n.id, color: temas.get(n.temas[0])?.color ?? "#6b7280", lugar: l.nombre, ubigeo: l.ubigeo },
    });
  }
  return { type: "FeatureCollection", features: feats };
}

function pintarDistritos() {
  for (const ub of distritosConNoticias) mapa.setFeatureState({ source: "distritos", id: ub }, { n: 0 });
  const cuenta = new Map<string, number>();
  for (const n of visibles) {
    const l = lugarPrincipal(n);
    if (esPuntual(l)) cuenta.set(l.ubigeo, (cuenta.get(l.ubigeo) ?? 0) + 1);
  }
  for (const [ub, k] of cuenta) mapa.setFeatureState({ source: "distritos", id: ub }, { n: k });
  distritosConNoticias = new Set(cuenta.keys());
}

function aplicarFiltros() {
  visibles = filtrar(todas, filtros);
  (mapa.getSource("noticias") as GeoJSONSource | undefined)?.setData(geojsonNoticias());
  pintarDistritos();
  const partes = [`${filtros.dias} días`];
  if (filtros.tema) partes.push(temas.get(filtros.tema)?.nombre ?? filtros.tema);
  if (filtros.medio) partes.push(filtros.medio);
  $("resumen-filtros").textContent = partes.join(" · ");
  if (zona) mostrarZona();
}

function mostrarZona() {
  if (!zona) return;
  (mapa.getSource("zona") as GeoJSONSource).setData(circuloZona(zona.centro, zona.radio));
  const r = noticiasEnZona(visibles, distritos, zona.centro, zona.radio);
  fichaContenido.innerHTML = fichaZona({ lugarTocado: zona.lugar, radio: zona.radio, r, temas, dias: filtros.dias });
  ficha.hidden = false;
  encuadrarZona();
}

/** Mueve el mapa para que el círculo quede a la vista por encima de la ficha (o a su derecha en pantallas anchas). */
function encuadrarZona() {
  if (!zona) return;
  const [o, s, e, n] = bboxCirculo(zona.centro, zona.radio);
  const ancha = window.innerWidth >= 720;
  const alto = ficha.getBoundingClientRect().height;
  mapa.fitBounds([[o, s], [e, n]], {
    padding: ancha ? { top: 40, bottom: 40, left: 440, right: 40 } : { top: 30, bottom: Math.min(alto + 20, window.innerHeight * 0.6), left: 30, right: 30 },
    maxZoom: 12,
    duration: 450,
  });
}

function bboxCirculo(c: [number, number], km: number): [number, number, number, number] {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((c[1] * Math.PI) / 180));
  return [c[0] - dLon, c[1] - dLat, c[0] + dLon, c[1] + dLat];
}

function cerrarFicha() {
  ficha.hidden = true;
  zona = null;
  (mapa.getSource("zona") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
}

function abrirPin(feats: MapGeoJSONFeature[]) {
  const ids = new Set(feats.map((f) => f.properties.id as string));
  const ns = visibles.filter((n) => ids.has(n.id)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const l = ns.length ? lugarPrincipal(ns[0]) : undefined;
  zona = null;
  (mapa.getSource("zona") as GeoJSONSource).setData({ type: "FeatureCollection", features: [] });
  fichaContenido.innerHTML = fichaLugar(
    l?.nombre ?? "Noticias",
    l ? `${l.precision === "centro_poblado" ? "Centro poblado · " : ""}${l.provincia} · ${l.departamento}` : "",
    ns,
    temas,
  );
  ficha.hidden = false;
}

mapa.on("load", async () => {
  etiquetasEnEspanol();
  try {
    const [dist, deps, idx, estado, listaTemas] = await Promise.all([
      cargarJSON<FeatureCollection>("data/layers/distritos.geojson"),
      cargarJSON<FeatureCollection>("data/layers/departamentos.geojson"),
      cargarJSON<IndiceNoticias>("data/news/index.json").catch(() => ({ actualizado: "", dias: [] })),
      cargarJSON<Estado>("data/status/estado.json").catch(() => null),
      cargarJSON<Tema[]>("data/status/temas.json").catch(() => [] as Tema[]),
    ]);
    distritos = dist;
    indice = idx;
    temas = new Map(listaTemas.map((t) => [t.clave, t]));
    prepararFiltros(listaTemas, estado);
    estadoEl.textContent = estado ? `Noticias actualizadas ${haceCuanto(estado.ultima_ejecucion)}` : "Sin datos de noticias";
    estadoEl.title = estado ? `Última actualización: ${new Date(estado.ultima_ejecucion).toLocaleString("es-PE", { timeZone: "America/Lima" })}` : "";

    mapa.addSource("distritos", { type: "geojson", data: distritos, promoteId: "ubigeo" });
    mapa.addSource("departamentos", { type: "geojson", data: deps });
    mapa.addSource("zona", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    mapa.addSource("noticias", {
      type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 38, clusterMaxZoom: 11,
    });

    mapa.addLayer({
      id: "distritos-relleno", type: "fill", source: "distritos",
      paint: {
        "fill-color": COLOR_ACENTO,
        "fill-opacity": ["interpolate", ["linear"], ["coalesce", ["feature-state", "n"], 0], 0, 0.02, 1, 0.12, 5, 0.22, 20, 0.35],
      },
    });
    mapa.addLayer({
      id: "distritos-borde", type: "line", source: "distritos", minzoom: 6,
      paint: { "line-color": "#5b6675", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.3, 10, 1], "line-opacity": 0.6 },
    });
    mapa.addLayer({
      id: "departamentos-borde", type: "line", source: "departamentos",
      paint: { "line-color": "#1f2a37", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 10, 2.2] },
    });
    mapa.addLayer({ id: "zona-relleno", type: "fill", source: "zona", paint: { "fill-color": "#1d4ed8", "fill-opacity": 0.08 } });
    mapa.addLayer({
      id: "zona-borde", type: "line", source: "zona", paint: { "line-color": "#1d4ed8", "line-width": 2, "line-dasharray": [2, 1] },
    });
    mapa.addLayer({
      id: "noticias-grupo", type: "circle", source: "noticias", filter: ["has", "point_count"],
      paint: {
        "circle-color": "#1f2a37", "circle-opacity": 0.85, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5,
        "circle-radius": ["step", ["get", "point_count"], 13, 10, 17, 50, 22],
      },
    });
    mapa.addLayer({
      id: "noticias-grupo-n", type: "symbol", source: "noticias", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 12 },
      paint: { "text-color": "#fff" },
    });
    mapa.addLayer({
      id: "noticias-punto", type: "circle", source: "noticias", filter: ["!", ["has", "point_count"]],
      paint: { "circle-color": ["get", "color"], "circle-radius": 7, "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
    });

    await cargarDias(filtros.dias);
    aplicarFiltros();
  } catch (err) {
    console.error(err);
    mostrarError("No se pudieron cargar los datos. Intenta recargar la página.");
    estadoEl.textContent = "Error";
  }
});

// ---------- Interacción ----------
mapa.on("click", async (e: MapMouseEvent) => {
  const grupos = mapa.queryRenderedFeatures(e.point, { layers: ["noticias-grupo"] });
  if (grupos.length) {
    const src = mapa.getSource("noticias") as GeoJSONSource;
    const zoom = await src.getClusterExpansionZoom(grupos[0].properties.cluster_id as number);
    mapa.easeTo({ center: (grupos[0].geometry as Point).coordinates as [number, number], zoom });
    return;
  }
  // Tolerancia de unos píxeles para tocar pines con el dedo.
  const caja: [[number, number], [number, number]] = [[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]];
  const pines = mapa.queryRenderedFeatures(caja, { layers: ["noticias-punto"] });
  if (pines.length) {
    abrirPin(pines);
    return;
  }
  const d = mapa.queryRenderedFeatures(e.point, { layers: ["distritos-relleno"] })[0];
  const p = d?.properties as { distrito: string; provincia: string; departamento: string } | undefined;
  zona = {
    centro: [e.lngLat.lng, e.lngLat.lat],
    radio: zona?.radio ?? 10,
    lugar: p ? `Alrededor de ${p.distrito} (${p.provincia}, ${p.departamento})` : "Zona seleccionada",
  };
  mostrarZona();
});
for (const capa of ["noticias-grupo", "noticias-punto"]) {
  mapa.on("mouseenter", capa, () => (mapa.getCanvas().style.cursor = "pointer"));
  mapa.on("mouseleave", capa, () => (mapa.getCanvas().style.cursor = ""));
}

ficha.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-radio]");
  if (b && zona) {
    zona.radio = Number(b.dataset.radio);
    mostrarZona();
  }
});
$("cerrar-ficha").addEventListener("click", cerrarFicha);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    cerrarFicha();
    cerrarFiltros();
  }
});

// ---------- Filtros ----------
function cerrarFiltros() {
  panelFiltros.hidden = true;
  botonFiltros.setAttribute("aria-expanded", "false");
}

botonFiltros.addEventListener("click", () => {
  const abrir = panelFiltros.hidden;
  panelFiltros.hidden = !abrir;
  botonFiltros.setAttribute("aria-expanded", String(abrir));
});

function prepararFiltros(lista: Tema[], estado: Estado | null) {
  const selTema = $<HTMLSelectElement>("filtro-tema");
  for (const t of lista) selTema.add(new Option(t.nombre, t.clave));
  const selMedio = $<HTMLSelectElement>("filtro-medio");
  const nombres = estado ? [...new Set(Object.values(estado.medios).map((m) => m.nombre))].sort((a, b) => a.localeCompare(b, "es")) : [];
  for (const n of nombres) selMedio.add(new Option(n, n));
  $("leyenda").innerHTML = lista
    .map((t) => `<span class="item-leyenda"><i style="background:${escapar(t.color)}"></i>${escapar(t.nombre)}</span>`)
    .join("");

  selTema.addEventListener("change", () => {
    filtros.tema = selTema.value;
    aplicarFiltros();
  });
  selMedio.addEventListener("change", () => {
    filtros.medio = selMedio.value;
    aplicarFiltros();
  });
  $("filtro-dias").addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-dias]");
    if (!b) return;
    for (const x of $("filtro-dias").querySelectorAll("button")) x.setAttribute("aria-checked", String(x === b));
    filtros.dias = Number(b.dataset.dias);
    estadoEl.textContent = "Cargando noticias…";
    await cargarDias(filtros.dias);
    estadoEl.textContent = `${visibles.length} noticias`;
    aplicarFiltros();
    estadoEl.textContent = `${visibles.length} noticias en ${filtros.dias} días`;
  });
}
