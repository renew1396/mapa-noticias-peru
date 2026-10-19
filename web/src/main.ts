import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import { Map as MapaLibre, NavigationControl, GeolocateControl, AttributionControl, setWorkerUrl } from "maplibre-gl";
// Vite no detecta solo el worker de MapLibre 6: lo empaquetamos y le pasamos su URL.
import urlWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { MapGeoJSONFeature } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

// Mapa base gratuito y sin clave (ver DECISIONS.md › Mapa base).
setWorkerUrl(urlWorker);

const ESTILO_BASE = "https://tiles.openfreemap.org/styles/positron";
const LIMITES_PERU: [number, number, number, number] = [-81.4, -18.4, -68.6, 0.1];

const ES = {
  "NavigationControl.ZoomIn": "Acercar",
  "NavigationControl.ZoomOut": "Alejar",
  "NavigationControl.ResetBearing": "Orientar al norte",
  "GeolocateControl.FindMyLocation": "Mi ubicación",
  "GeolocateControl.LocationNotAvailable": "Ubicación no disponible",
  "AttributionControl.ToggleAttribution": "Créditos del mapa",
};

interface Meta { fuente: string; fecha_carga: string; fecha_corte: string }

const estado = document.getElementById("estado")!;
const ficha = document.getElementById("ficha")!;
const fichaContenido = document.getElementById("ficha-contenido")!;

async function cargarJSON<T>(ruta: string): Promise<T> {
  const r = await fetch(ruta);
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

function mostrarError(texto: string) {
  const div = document.createElement("div");
  div.className = "error";
  div.textContent = texto;
  document.getElementById("mapa")!.appendChild(div);
  estado.textContent = "Error";
}

function escapar(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

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

let seleccionado: string | null = null;

function seleccionar(ubigeo: string | null) {
  if (seleccionado) mapa.setFeatureState({ source: "distritos", id: seleccionado }, { sel: false });
  seleccionado = ubigeo;
  if (ubigeo) mapa.setFeatureState({ source: "distritos", id: ubigeo }, { sel: true });
}

function abrirFicha(f: MapGeoJSONFeature, meta: Meta | null) {
  const p = f.properties as { ubigeo: string; distrito: string; provincia: string; departamento: string };
  seleccionar(p.ubigeo);
  fichaContenido.innerHTML = `
    <h2>${escapar(p.distrito)}</h2>
    <p class="ruta">Provincia de ${escapar(p.provincia)} · ${escapar(p.departamento)}</p>
    <dl>
      <dt>Ubigeo</dt><dd>${escapar(p.ubigeo)}</dd>
    </dl>
    ${meta ? `<p class="fuente">Límites: ${escapar(meta.fuente)}. Cargado el ${meta.fecha_carga.slice(0, 10)}.</p>` : ""}`;
  ficha.hidden = false;
}

function cerrarFicha() {
  ficha.hidden = true;
  seleccionar(null);
}
document.getElementById("cerrar-ficha")!.addEventListener("click", cerrarFicha);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarFicha(); });

// Etiquetas del mapa base en español: nombre en español si existe, si no el nombre local.
function etiquetasEnEspanol() {
  for (const capa of mapa.getStyle().layers) {
    if (capa.type === "symbol" && mapa.getLayoutProperty(capa.id, "text-field")) {
      mapa.setLayoutProperty(capa.id, "text-field", ["coalesce", ["get", "name:es"], ["get", "name"]]);
    }
  }
}

mapa.on("load", async () => {
  etiquetasEnEspanol();
  try {
    const [distritos, departamentos, meta] = await Promise.all([
      cargarJSON<FeatureCollection>("data/layers/distritos.geojson"),
      cargarJSON<FeatureCollection>("data/layers/departamentos.geojson"),
      cargarJSON<Meta>("data/layers/distritos.meta.json").catch(() => null),
    ]);

    mapa.addSource("distritos", { type: "geojson", data: distritos, promoteId: "ubigeo" });
    mapa.addSource("departamentos", { type: "geojson", data: departamentos });

    mapa.addLayer({
      id: "distritos-relleno",
      type: "fill",
      source: "distritos",
      paint: {
        "fill-color": "#c2410c",
        "fill-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 0.35, 0.02],
      },
    });
    mapa.addLayer({
      id: "distritos-borde",
      type: "line",
      source: "distritos",
      minzoom: 6,
      paint: { "line-color": "#5b6675", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.3, 10, 1], "line-opacity": 0.6 },
    });
    mapa.addLayer({
      id: "departamentos-borde",
      type: "line",
      source: "departamentos",
      paint: { "line-color": "#1f2a37", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 10, 2.2] },
    });
    mapa.addLayer({
      id: "distritos-seleccion",
      type: "line",
      source: "distritos",
      paint: {
        "line-color": "#c2410c",
        "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.5, 0],
      },
    });

    mapa.on("click", "distritos-relleno", (e) => {
      const f = e.features?.[0];
      if (f) abrirFicha(f, meta);
    });
    mapa.on("mouseenter", "distritos-relleno", () => (mapa.getCanvas().style.cursor = "pointer"));
    mapa.on("mouseleave", "distritos-relleno", () => (mapa.getCanvas().style.cursor = ""));

    estado.textContent = `${distritos.features.length.toLocaleString("es-PE")} distritos`;
  } catch (err) {
    console.error(err);
    mostrarError("No se pudieron cargar los límites de los distritos. Intenta recargar la página.");
  }
});

mapa.on("error", (e) => console.error("Error del mapa:", e.error));
