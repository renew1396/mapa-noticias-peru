// Armado del HTML de la ficha. Todo texto que viene de los RSS pasa por `escapar` (nunca innerHTML crudo).
import type { Noticia, Tema } from "./tipos";
import { lugarPrincipal, type ResultadoZona } from "./zona";

export function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function urlSegura(u: string): string {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : "#";
  } catch {
    return "#";
  }
}

const fmtFecha = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

export function fechaLima(iso: string): string {
  return fmtFecha.format(new Date(iso));
}

export function haceCuanto(iso: string, ahora = Date.now()): string {
  const min = Math.round((ahora - Date.parse(iso)) / 60_000);
  if (min < 2) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export const RADIOS = [1, 5, 10, 25, 50];

function itemNoticia(n: Noticia, temas: Map<string, Tema>): string {
  const l = lugarPrincipal(n);
  const t = temas.get(n.temas[0]) ?? { nombre: "Otros", color: "#6b7280", clave: "otros" };
  const lugar = l ? `${l.nombre}${l.precision === "departamento" ? " (región)" : l.precision === "provincia" ? " (provincia)" : ""}` : "";
  return `
    <li class="noticia">
      <a href="${escapar(urlSegura(n.url))}" target="_blank" rel="noopener noreferrer">${escapar(n.titulo)}</a>
      <div class="meta">
        <span class="tema" style="--c:${escapar(t.color)}">${escapar(t.nombre)}</span>
        <span>${escapar(n.medio)}</span> · <time datetime="${escapar(n.fecha)}">${fechaLima(n.fecha)}</time>
        ${lugar ? ` · <span class="lugar">${escapar(lugar)}</span>` : ""}
        ${n.revisar ? ` · <span class="dudosa" title="Ubicación con confianza baja">ubicación dudosa</span>` : ""}
      </div>
    </li>`;
}

export function listaNoticias(ns: Noticia[], temas: Map<string, Tema>, max = 60): string {
  if (!ns.length) return "";
  const extra = ns.length > max ? `<p class="nota">Se muestran las ${max} más recientes de ${ns.length}.</p>` : "";
  return `<ul class="noticias">${ns.slice(0, max).map((n) => itemNoticia(n, temas)).join("")}</ul>${extra}`;
}

export function fichaZona(opts: {
  lugarTocado: string;
  radio: number;
  r: ResultadoZona;
  temas: Map<string, Tema>;
  dias: number;
}): string {
  const { lugarTocado, radio, r, temas, dias } = opts;
  const chips = RADIOS.map(
    (km) => `<button class="chip ${km === radio ? "activo" : ""}" data-radio="${km}" aria-pressed="${km === radio}">${km} km</button>`,
  ).join("");
  const nombres = r.distritos.map((d) => d.properties.distrito).sort((a, b) => a.localeCompare(b, "es"));
  const distritosTxt =
    nombres.length <= 6 ? nombres.join(", ") : `${nombres.slice(0, 6).join(", ")} y ${nombres.length - 6} más`;
  const vacio = !r.puntuales.length && !r.amplias.length;
  return `
    <h2>${escapar(lugarTocado)}</h2>
    <p class="ruta">Zona de ${radio} km · últimos ${dias} días</p>
    <div class="chips" role="group" aria-label="Radio de la zona">${chips}</div>
    <p class="distritos"><strong>${nombres.length} distrito${nombres.length === 1 ? "" : "s"}:</strong> ${escapar(distritosTxt)}</p>
    ${vacio ? `<p class="vacio">No hay noticias en esta zona para el período y los filtros elegidos. Prueba con un radio mayor o 30/90 días.</p>` : ""}
    ${r.puntuales.length ? `<h3>${r.puntuales.length} noticia${r.puntuales.length === 1 ? "" : "s"} en la zona</h3>${listaNoticias(r.puntuales, temas)}` : ""}
    ${r.amplias.length ? `<details ${r.puntuales.length ? "" : "open"}><summary>${r.amplias.length} de la provincia o región</summary>${listaNoticias(r.amplias, temas)}</details>` : ""}`;
}

export function fichaLugar(titulo: string, subtitulo: string, ns: Noticia[], temas: Map<string, Tema>): string {
  return `
    <h2>${escapar(titulo)}</h2>
    <p class="ruta">${escapar(subtitulo)}</p>
    ${listaNoticias(ns, temas)}`;
}
