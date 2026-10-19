import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import {
  Map as MapaLibre, NavigationControl, GeolocateControl, AttributionControl, setWorkerUrl,
  type GeoJSONSource, type MapGeoJSONFeature, type MapMouseEvent,
} from "maplibre-gl";
// Vite no detecta solo el worker de MapLibre 6: lo empaquetamos y le pasamos su URL.
import urlWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type { Estado, IndiceNoticias, Noticia, Tema } from "./tipos";
import {
  areaKm2, esPuntual, filtrar, lugarPrincipal, noticiasEnZona, puntosEnZona, resumenPobreza, zonaCirculo, zonaPoligono,
  type Filtros, type Zona,
} from "./zona";
import {
  escapar, fichaConcesion, fichaConflicto, fichaLugar, fichaSalud, fichaZona, haceCuanto, leyenda, type Indicadores,
} from "./ui";
import {
  actualizarCalor, cargar, cargarMetas, datos, mostrarCapa, prepararCapa, type IdCapa, type PropsConflicto, type PropsSalud,
} from "./capas";

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
const leyendaMapa = $("leyenda-mapa");

// ---------- Estado de la aplicación ----------
const filtros: Filtros = { dias: 7, tema: "", medio: "" };
let indice: IndiceNoticias = { actualizado: "", dias: [] };
const diasCargados = new Map<string, Noticia[]>();
let todas: Noticia[] = [];
let visibles: Noticia[] = [];
let distritos: FeatureCollection = { type: "FeatureCollection", features: [] };
let temas = new Map<string, Tema>();
let distritosConNoticias = new Set<string>();
const capasActivas = new Set<IdCapa>();
let pinesVisibles = true;
let dibujando = false;

/** La zona abierta en la ficha: un círculo (con radio) o un polígono dibujado. */
let zonaActual:
  | { tipo: "circulo"; centro: [number, number]; radio: number; tocado?: Indicadores["tocado"] }
  | { tipo: "poligono"; forma: Feature<Polygon> }
  | null = null;

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
  const fc = geojsonNoticias();
  (mapa.getSource("noticias") as GeoJSONSource | undefined)?.setData(fc);
  actualizarCalor(mapa, fc);
  pintarDistritos();
  const partes = [`${filtros.dias} días`];
  if (filtros.tema) partes.push(temas.get(filtros.tema)?.nombre ?? filtros.tema);
  if (filtros.medio) partes.push(filtros.medio);
  if (capasActivas.size) partes.push(`${capasActivas.size} capa${capasActivas.size > 1 ? "s" : ""}`);
  $("resumen-filtros").textContent = partes.join(" · ");
  if (zonaActual) mostrarZona(false);
}

// ---------- Zona y ficha ----------
function zonaVigente(): Zona | null {
  if (!zonaActual) return null;
  return zonaActual.tipo === "circulo" ? zonaCirculo(zonaActual.centro, zonaActual.radio) : zonaPoligono(zonaActual.forma);
}

/** Indicadores de la zona con lo que ya está cargado (lo que falta muestra "cargando…"). */
function indicadores(zona: Zona, ubigeos: string[]): Indicadores {
  const ind: Indicadores = {};
  if (zonaActual?.tipo === "circulo") ind.tocado = zonaActual.tocado;
  ind.pobreza = datos.pobreza ? resumenPobreza(ubigeos, datos.pobreza) : undefined;
  if (datos.concesionesCentros) {
    let n = 0, ha = 0;
    const [o, s, e, nn] = zona.caja;
    for (const [lon, lat, h] of datos.concesionesCentros) {
      if (lon < o || lon > e || lat < s || lat > nn) continue;
      if (zona.contiene([lon, lat])) { n++; ha += h; }
    }
    ind.concesiones = { n, ha };
  } else ind.concesiones = null;
  if (datos.salud) {
    const ps = puntosEnZona(datos.salud, zona);
    ind.salud = { total: ps.length, publicos: ps.filter((p) => p.properties.p === 1).length };
  } else ind.salud = null;
  if (datos.conflictos) {
    const set = new Set(ubigeos);
    ind.conflictos = datos.conflictos.features
      .filter((f) => zona.contiene(f.geometry.coordinates as [number, number]) || f.properties.distritos.some((u) => set.has(u)))
      .map((f) => f.properties);
  } else ind.conflictos = null;
  return ind;
}

/** En el celular la leyenda se pliega al abrir una ficha, para no tapar la zona. */
function plegarLeyendaEnCelular() {
  if (window.innerWidth < 720 && leyendaAbierta) {
    leyendaAbierta = false;
    pintarLeyenda();
  }
}

/** Guarda la zona en el enlace (#zona=lon,lat,radio o #poligono=lon,lat;lon,lat;…) para poder compartirla. */
function guardarZonaEnEnlace() {
  let h = "";
  if (zonaActual?.tipo === "circulo") h = `#zona=${zonaActual.centro.map((x) => x.toFixed(4)).join(",")},${zonaActual.radio}`;
  else if (zonaActual?.tipo === "poligono")
    h = `#poligono=${zonaActual.forma.geometry.coordinates[0].map((c) => `${c[0].toFixed(4)},${c[1].toFixed(4)}`).join(";")}`;
  history.replaceState(null, "", h || location.pathname + location.search);
}

function zonaDesdeEnlace() {
  const m = location.hash.match(/^#zona=(-?[\d.]+),(-?[\d.]+),(\d+)$/);
  if (m) {
    const centro: [number, number] = [Number(m[1]), Number(m[2])];
    const punto = mapa.project(centro);
    const d = mapa.queryRenderedFeatures(punto, { layers: ["distritos-relleno"] })[0]?.properties;
    zonaActual = { tipo: "circulo", centro, radio: Math.min(50, Math.max(1, Number(m[3]))),
      tocado: d ? { ubigeo: d.ubigeo, distrito: d.distrito, provincia: d.provincia, departamento: d.departamento } : undefined };
    mostrarZona();
    return;
  }
  const p = location.hash.match(/^#poligono=([-\d.,;]+)$/);
  if (p) {
    const anillo = p[1].split(";").map((par) => par.split(",").map(Number)).filter((c) => c.length === 2 && c.every(Number.isFinite));
    if (anillo.length >= 4) {
      zonaActual = { tipo: "poligono", forma: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [anillo] } } };
      mostrarZona();
    }
  }
}

function mostrarZona(encuadrar = true) {
  const zona = zonaVigente();
  if (!zona || !zonaActual) return;
  plegarLeyendaEnCelular();
  guardarZonaEnEnlace();
  (mapa.getSource("zona") as GeoJSONSource).setData(zona.forma);
  const r = noticiasEnZona(visibles, distritos, zona);
  const ubigeos = r.distritos.map((d) => d.properties.ubigeo);
  const ind = indicadores(zona, ubigeos);
  const titulo = zonaActual.tipo === "circulo"
    ? (zonaActual.tocado ? `Alrededor de ${zonaActual.tocado.distrito}` : "Zona seleccionada")
    : "Zona dibujada";
  const subtitulo = zonaActual.tipo === "circulo"
    ? `Radio de ${zonaActual.radio} km · noticias de los últimos ${filtros.dias} días`
    : `${Math.round(areaKm2(zonaActual.forma)).toLocaleString("es-PE")} km² · noticias de los últimos ${filtros.dias} días`;
  fichaContenido.innerHTML = fichaZona({ titulo, subtitulo, radio: zonaActual.tipo === "circulo" ? zonaActual.radio : null, r, temas, ind });
  ficha.hidden = false;
  if (encuadrar) encuadrarZona(zona);
  // Completar en segundo plano lo que falta (la ficha se vuelve a dibujar al llegar).
  const faltan: Promise<unknown>[] = [];
  if (!datos.pobreza) faltan.push(cargar.pobreza());
  if (!datos.concesionesCentros) faltan.push(cargar.concesionesResumen());
  if (!datos.salud) faltan.push(cargar.salud());
  if (!datos.conflictos) faltan.push(cargar.conflictos());
  if (faltan.length) Promise.allSettled(faltan).then(() => zonaActual && mostrarZona(false));
}

/** Mueve el mapa para que la zona quede a la vista por encima de la ficha (o a su derecha en pantallas anchas). */
function encuadrarZona(zona: Zona) {
  const [o, s, e, n] = zona.caja;
  const ancha = window.innerWidth >= 720;
  const alto = ficha.getBoundingClientRect().height;
  mapa.fitBounds([[o, s], [e, n]], {
    padding: ancha ? { top: 40, bottom: 40, left: 440, right: 40 } : { top: 30, bottom: Math.min(alto + 20, window.innerHeight * 0.6), left: 30, right: 30 },
    maxZoom: 12,
    duration: 450,
  });
}

function cerrarFicha() {
  ficha.hidden = true;
  zonaActual = null;
  guardarZonaEnEnlace();
  (mapa.getSource("zona") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
}

function abrirFicha(html: string) {
  plegarLeyendaEnCelular();
  zonaActual = null;
  guardarZonaEnEnlace();
  (mapa.getSource("zona") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
  fichaContenido.innerHTML = html;
  ficha.hidden = false;
}

function abrirPin(feats: MapGeoJSONFeature[]) {
  const ids = new Set(feats.map((f) => f.properties.id as string));
  const ns = visibles.filter((n) => ids.has(n.id)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const l = ns.length ? lugarPrincipal(ns[0]) : undefined;
  abrirFicha(fichaLugar(
    l?.nombre ?? "Noticias",
    l ? `${l.precision === "centro_poblado" ? "Centro poblado · " : ""}${l.provincia} · ${l.departamento}` : "",
    ns,
    temas,
  ));
}

function nombreDistrito(ubigeo: string): string {
  const d = distritos.features.find((f) => f.properties?.ubigeo === ubigeo);
  return d ? `${d.properties!.distrito} (${d.properties!.provincia}, ${d.properties!.departamento})` : "";
}

// ---------- Leyenda flotante ----------
let leyendaAbierta = window.innerWidth >= 720; // en el celular empieza plegada para no tapar el mapa

function pintarLeyenda() {
  const html = leyenda(capasActivas);
  leyendaMapa.hidden = !html;
  if (!html) return;
  const n = capasActivas.size;
  leyendaMapa.innerHTML = `<details ${leyendaAbierta ? "open" : ""}><summary>Leyenda · ${n} capa${n > 1 ? "s" : ""}</summary>
    <div class="cuerpo-leyenda">${html}</div></details>`;
  leyendaMapa.querySelector("details")!.addEventListener("toggle", (e) => {
    leyendaAbierta = (e.target as HTMLDetailsElement).open;
  });
}

// ---------- Carga inicial ----------
mapa.on("load", async () => {
  etiquetasEnEspanol();
  try {
    const [dist, deps, idx, estado, listaTemas] = await Promise.all([
      cargarJSON<FeatureCollection>("data/layers/distritos.geojson"),
      cargarJSON<FeatureCollection>("data/layers/departamentos.geojson"),
      cargarJSON<IndiceNoticias>("data/news/index.json").catch(() => ({ actualizado: "", dias: [] })),
      cargarJSON<Estado>("data/status/estado.json").catch(() => null),
      cargarJSON<Tema[]>("data/status/temas.json").catch(() => [] as Tema[]),
      cargarMetas(),
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
    if (location.hash) mapa.once("idle", zonaDesdeEnlace);
  } catch (err) {
    console.error(err);
    mostrarError("No se pudieron cargar los datos. Intenta recargar la página.");
    estadoEl.textContent = "Error";
  }
});

// ---------- Interacción ----------
const CAPAS_TOCABLES = ["noticias-grupo", "noticias-punto", "conflictos-punto", "salud-grupo", "salud-punto", "concesiones-relleno"];

mapa.on("click", async (e: MapMouseEvent) => {
  if (dibujando) return;
  const existentes = (ids: string[]) => ids.filter((l) => mapa.getLayer(l) && mapa.getLayoutProperty(l, "visibility") !== "none");
  const caja: [[number, number], [number, number]] = [[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]];

  for (const [capa, fuenteId] of [["noticias-grupo", "noticias"], ["salud-grupo", "salud"]] as const) {
    if (!existentes([capa]).length) continue;
    const g = mapa.queryRenderedFeatures(e.point, { layers: [capa] });
    if (g.length) {
      const zoom = await (mapa.getSource(fuenteId) as GeoJSONSource).getClusterExpansionZoom(g[0].properties.cluster_id as number);
      mapa.easeTo({ center: (g[0].geometry as Point).coordinates as [number, number], zoom });
      return;
    }
  }
  const conf = existentes(["conflictos-punto"]).length ? mapa.queryRenderedFeatures(caja, { layers: ["conflictos-punto"] }) : [];
  if (conf.length) {
    const p = conf[0].properties as Record<string, unknown>;
    const props = { ...p, distritos: typeof p.distritos === "string" ? JSON.parse(p.distritos as string) : p.distritos } as PropsConflicto;
    abrirFicha(fichaConflicto(props));
    return;
  }
  const pines = existentes(["noticias-punto"]).length ? mapa.queryRenderedFeatures(caja, { layers: ["noticias-punto"] }) : [];
  if (pines.length) {
    abrirPin(pines);
    return;
  }
  const salud = existentes(["salud-punto"]).length ? mapa.queryRenderedFeatures(caja, { layers: ["salud-punto"] }) : [];
  if (salud.length) {
    const s = salud[0].properties as PropsSalud;
    abrirFicha(fichaSalud(s, nombreDistrito(s.u)));
    return;
  }
  const conc = existentes(["concesiones-relleno"]).length ? mapa.queryRenderedFeatures(e.point, { layers: ["concesiones-relleno"] }) : [];
  if (conc.length && mapa.getZoom() >= 9) {
    abrirFicha(fichaConcesion(conc[0].properties));
    return;
  }
  const d = mapa.queryRenderedFeatures(e.point, { layers: ["distritos-relleno"] })[0];
  const p = d?.properties as { ubigeo: string; distrito: string; provincia: string; departamento: string } | undefined;
  zonaActual = {
    tipo: "circulo",
    centro: [e.lngLat.lng, e.lngLat.lat],
    radio: zonaActual?.tipo === "circulo" ? zonaActual.radio : 10,
    tocado: p ? { ubigeo: p.ubigeo, distrito: p.distrito, provincia: p.provincia, departamento: p.departamento } : undefined,
  };
  mostrarZona();
});
for (const capa of CAPAS_TOCABLES) {
  mapa.on("mouseenter", capa, () => (mapa.getCanvas().style.cursor = "pointer"));
  mapa.on("mouseleave", capa, () => (mapa.getCanvas().style.cursor = ""));
}

ficha.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-radio]");
  if (b && zonaActual?.tipo === "circulo") {
    zonaActual.radio = Number(b.dataset.radio);
    mostrarZona();
  }
});
$("cerrar-ficha").addEventListener("click", cerrarFicha);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (dibujando) terminarDibujo();
    cerrarFicha();
    cerrarFiltros();
  }
});

// ---------- Dibujo de polígono (Terra Draw) ----------
let draw: TerraDraw | null = null;
const botonDibujar = $<HTMLButtonElement>("dibujar");

function empezarDibujo() {
  cerrarFicha();
  cerrarFiltros();
  if (!draw) {
    draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map: mapa }),
      modes: [new TerraDrawPolygonMode({
        styles: { fillColor: "#1d4ed8", fillOpacity: 0.12, outlineColor: "#1d4ed8", outlineWidth: 2, closingPointColor: "#1d4ed8" },
      })],
    });
    draw.on("finish", (id) => {
      const f = draw?.getSnapshotFeature(id);
      terminarDibujo();
      if (f && f.geometry.type === "Polygon") {
        zonaActual = { tipo: "poligono", forma: { type: "Feature", properties: {}, geometry: f.geometry as Polygon } };
        mostrarZona();
      }
    });
  }
  draw.start();
  draw.setMode("polygon");
  dibujando = true;
  botonDibujar.setAttribute("aria-pressed", "true");
  $("aviso-dibujo").hidden = false;
}

function terminarDibujo() {
  // El mismo toque que cierra el polígono también le llega al mapa como "clic": se ignora un instante más
  // para que no abra un círculo encima de la zona dibujada.
  setTimeout(() => (dibujando = false), 400);
  botonDibujar.setAttribute("aria-pressed", "false");
  $("aviso-dibujo").hidden = true;
  if (draw) {
    draw.clear();
    draw.stop();
  }
}

botonDibujar.addEventListener("click", () => (dibujando ? terminarDibujo() : empezarDibujo()));
$("cancelar-dibujo").addEventListener("click", terminarDibujo);

// ---------- Capas y filtros ----------
function cerrarFiltros() {
  panelFiltros.hidden = true;
  botonFiltros.setAttribute("aria-expanded", "false");
}

botonFiltros.addEventListener("click", () => {
  const abrir = panelFiltros.hidden;
  panelFiltros.hidden = !abrir;
  botonFiltros.setAttribute("aria-expanded", String(abrir));
});

panelFiltros.addEventListener("change", async (e) => {
  const input = (e.target as HTMLElement).closest<HTMLInputElement>("input[data-capa]");
  if (!input) return;
  const id = input.dataset.capa!;
  if (id === "noticias") {
    pinesVisibles = input.checked;
    for (const l of ["noticias-grupo", "noticias-grupo-n", "noticias-punto"]) {
      mapa.setLayoutProperty(l, "visibility", pinesVisibles ? "visible" : "none");
    }
    return;
  }
  const capa = id as IdCapa;
  if (input.checked) {
    input.disabled = true;
    const etiqueta = estadoEl.textContent;
    estadoEl.textContent = "Cargando capa…";
    try {
      const ok = await prepararCapa(mapa, capa, "distritos-borde");
      if (!ok) {
        input.checked = false;
        alert("Esta capa todavía no está disponible. Vuelve a intentarlo más tarde.");
      } else {
        capasActivas.add(capa);
        mostrarCapa(mapa, capa, true);
        if (capa === "calor") actualizarCalor(mapa, geojsonNoticias());
      }
    } catch (err) {
      console.error(err);
      input.checked = false;
      alert("No se pudo cargar la capa. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      input.disabled = false;
      estadoEl.textContent = etiqueta;
    }
  } else {
    capasActivas.delete(capa);
    mostrarCapa(mapa, capa, false);
  }
  // Con pobreza encendida, el tinte de "distritos con noticias" confundiría los colores (la capa sigue
  // existiendo, transparente, para que tocar un distrito funcione igual).
  if (mapa.getLayer("pobreza-relleno")) {
    mapa.setPaintProperty("distritos-relleno", "fill-opacity", capasActivas.has("pobreza") ? 0
      : ["interpolate", ["linear"], ["coalesce", ["feature-state", "n"], 0], 0, 0.02, 1, 0.12, 5, 0.22, 20, 0.35]);
  }
  pintarLeyenda();
  aplicarFiltros();
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
    aplicarFiltros();
    estadoEl.textContent = `${visibles.length} noticias en ${filtros.dias} días`;
  });
}
