// Armado del HTML de la ficha. Todo texto que viene de los RSS pasa por `escapar` (nunca innerHTML crudo).
import type { Noticia, Tema } from "./tipos";
import { lugarPrincipal, type ResultadoZona } from "./zona";
import {
  COLOR_CONCESION, COLOR_SALUD_PRIVADO, COLOR_SALUD_PUBLICO, COLORES_POBREZA, cortesPobreza, datos,
  type IdCapa, type Meta, type PropsConflicto, type PropsSalud,
} from "./capas";

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

export interface Indicadores {
  tocado?: { distrito: string; provincia: string; departamento: string; ubigeo: string };
  pobreza?: { conDato: number; sinDato: number; minimo: number; maximo: number; inferior: number; superior: number } | null;
  concesiones?: { n: number; ha: number } | null;
  salud?: { total: number; publicos: number } | null;
  conflictos?: PropsConflicto[] | null;
}

// Un decimal para valores chicos (0,3 % no es lo mismo que 0 %); entero para el resto.
const pct = (x: number) => `${x.toLocaleString("es-PE", { maximumFractionDigits: x < 10 ? 1 : 0 })} %`;
const miles = (x: number) => x.toLocaleString("es-PE");

export function fuente(m: Meta | undefined, extra = ""): string {
  if (!m) return "";
  return `<span class="fuente">Fuente: <a href="${escapar(urlSegura(m.url))}" target="_blank" rel="noopener">${escapar(m.fuente)}</a>${
    m.fecha_corte ? ` · corte ${escapar(m.fecha_corte)}` : ""}${extra}</span>`;
}

function bloqueTocado(ind: Indicadores): string {
  const t = ind.tocado;
  if (!t) return "";
  const pob = datos.pobreza?.[t.ubigeo];
  const con = datos.concesionesDistritos?.[t.ubigeo];
  const filas = [
    pob ? `<li>Pobreza monetaria: <strong>${pct(pob[0])}–${pct(pob[1])}</strong> (INEI 2018, intervalo al 95 %)</li>` :
      datos.pobreza ? `<li>Pobreza monetaria: sin dato (distrito creado después de 2018)</li>` : "",
    con ? `<li>Concesiones mineras vigentes: <strong>${miles(con[0])}</strong>, cubren ~${pct(con[1])} del distrito</li>` :
      datos.concesionesDistritos ? `<li>Sin concesiones mineras vigentes</li>` : "",
  ].join("");
  return `<div class="tocado"><p><strong>${escapar(t.distrito)}</strong> · ${escapar(t.provincia)}, ${escapar(t.departamento)} ·
    ubigeo ${escapar(t.ubigeo)}</p>${filas ? `<ul>${filas}</ul>` : ""}</div>`;
}

function bloqueIndicadores(ind: Indicadores): string {
  const filas: string[] = [];
  const cargando = `<span class="cargando">cargando…</span>`;
  if (ind.pobreza !== undefined) {
    const p = ind.pobreza;
    filas.push(`<li><span class="ind">Pobreza monetaria</span> ${
      p ? `${p.conDato === 1 ? `<strong>${pct(p.inferior)}–${pct(p.superior)}</strong>` :
        `entre <strong>${pct(p.minimo)}</strong> y <strong>${pct(p.maximo)}</strong> según distrito`}${
        p.sinDato ? ` <span class="nota-ind">(${p.sinDato} sin dato)</span>` : ""}` : "sin dato"}
      ${fuente(datos.meta.pobreza, p && p.conDato > 1 ? " · punto medio del intervalo" : "")}</li>`);
  }
  if (ind.concesiones !== undefined) {
    const c = ind.concesiones;
    filas.push(`<li><span class="ind">Concesiones mineras vigentes</span> ${
      c === null ? cargando : `<strong>${miles(c.n)}</strong>${c.n ? ` (~${miles(Math.round(c.ha))} ha)` : ""}`}
      ${fuente(datos.meta.concesiones, " · cuenta por punto interior")}</li>`);
  }
  if (ind.salud !== undefined) {
    const s = ind.salud;
    filas.push(`<li><span class="ind">Establecimientos de salud activos</span> ${
      s === null ? cargando : `<strong>${miles(s.total)}</strong>${s.total ? ` (${miles(s.publicos)} públicos)` : ""}`}
      ${fuente(datos.meta.salud)}</li>`);
  }
  if (ind.conflictos !== undefined) {
    const c = ind.conflictos;
    filas.push(`<li><span class="ind">Conflictos sociales registrados</span> ${c === null ? cargando : `<strong>${c.length}</strong>`}
      ${fuente(datos.meta.conflictos)}
      ${c && c.length ? `<ul class="conflictos">${c.slice(0, 8).map((x) =>
        `<li><strong>${escapar(x.tipo || "Conflicto")}</strong> · ${escapar(x.lugar)}: ${escapar(x.caso.slice(0, 160))}${x.caso.length > 160 ? "…" : ""}</li>`).join("")}</ul>` : ""}</li>`);
  }
  return filas.length ? `<h3>Contexto de la zona</h3><ul class="indicadores">${filas.join("")}</ul>` : "";
}

export function fichaZona(opts: {
  titulo: string;
  subtitulo: string;
  radio: number | null;
  r: ResultadoZona;
  temas: Map<string, Tema>;
  ind: Indicadores;
}): string {
  const { titulo, subtitulo, radio, r, temas, ind } = opts;
  const chips = radio === null ? "" : `<div class="chips" role="group" aria-label="Radio de la zona">${RADIOS.map(
    (km) => `<button class="chip ${km === radio ? "activo" : ""}" data-radio="${km}" aria-pressed="${km === radio}">${km} km</button>`,
  ).join("")}</div>`;
  const nombres = r.distritos.map((d) => d.properties.distrito).sort((a, b) => a.localeCompare(b, "es"));
  const distritosTxt =
    nombres.length <= 6 ? nombres.join(", ") : `${nombres.slice(0, 6).join(", ")} y ${nombres.length - 6} más`;
  const vacio = !r.puntuales.length && !r.amplias.length;
  return `
    <h2>${escapar(titulo)}</h2>
    <p class="ruta">${escapar(subtitulo)}</p>
    ${chips}
    ${bloqueTocado(ind)}
    <p class="distritos"><strong>${nombres.length} distrito${nombres.length === 1 ? "" : "s"} en la zona:</strong> ${escapar(distritosTxt)}</p>
    ${bloqueIndicadores(ind)}
    <h3>Noticias</h3>
    ${vacio ? `<p class="vacio">No hay noticias en esta zona para el período y los filtros elegidos. Prueba con una zona más grande o 30/90 días.</p>` : ""}
    ${r.puntuales.length ? `<p class="subt">${r.puntuales.length} en la zona</p>${listaNoticias(r.puntuales, temas)}` : ""}
    ${r.amplias.length ? `<details ${r.puntuales.length ? "" : "open"}><summary>${r.amplias.length} de la provincia o región</summary>${listaNoticias(r.amplias, temas)}</details>` : ""}`;
}

export function fichaConflicto(c: PropsConflicto): string {
  return `
    <h2>${escapar(c.tipo || "Conflicto social")}</h2>
    <p class="ruta">${escapar(c.lugar)} · ${escapar(c.departamento)}${c.dialogo ? ` · ${escapar(c.dialogo)}` : ""}</p>
    <p>${escapar(c.caso)}</p>
    ${c.ubicacion ? `<p class="detalle"><strong>Ubicación según el reporte:</strong> ${escapar(c.ubicacion)}</p>` : ""}
    <p class="detalle">Código del caso: ${escapar(c.codigo)}</p>
    <p>${fuente(datos.meta.conflictos)}</p>`;
}

export function fichaSalud(s: PropsSalud, lugar: string): string {
  return `
    <h2>${escapar(s.n)}</h2>
    <p class="ruta">${escapar(s.t)}${s.c ? ` · categoría ${escapar(s.c)}` : ""}</p>
    <ul class="indicadores"><li>${escapar(s.i)} (${s.p ? "público" : "privado"})</li><li>${escapar(lugar)} · ubigeo ${escapar(s.u)}</li></ul>
    <p>${fuente(datos.meta.salud)}</p>`;
}

export function fichaConcesion(p: Record<string, unknown>): string {
  const v = (k: string) => escapar(String(p[k] ?? ""));
  return `
    <h2>${v("nombre") || "Concesión minera"}</h2>
    <p class="ruta">${v("estado")}${p.sustancia ? ` · sustancia ${v("sustancia").toLowerCase()}` : ""}</p>
    <ul class="indicadores">
      <li>Titular: ${v("titular") || "—"}</li>
      <li>Superficie: ${miles(Number(p.ha) || 0)} ha${p.anio ? ` · petitorio de ${v("anio")}` : ""}</li>
      <li>Código: ${v("codigo")}</li>
    </ul>
    <p>${fuente(datos.meta.concesiones)}</p>`;
}

// ---------- Leyendas ----------
export function leyenda(activas: Set<IdCapa>): string {
  const partes: string[] = [];
  if (activas.has("pobreza")) {
    const c = cortesPobreza();
    const lim = [0, ...c, 100];
    partes.push(`<div class="ley"><strong>Pobreza monetaria (%)</strong>
      <div class="escala">${COLORES_POBREZA.map((col, i) =>
        `<span><i style="background:${col}"></i>${Math.round(lim[i])}–${Math.round(lim[i + 1])}</span>`).join("")}
        <span><i style="background:#e5e7eb"></i>sin dato</span></div>
      ${fuente(datos.meta.pobreza)}</div>`);
  }
  if (activas.has("conflictos"))
    partes.push(`<div class="ley"><span class="sim conflicto"></span><strong>Conflictos sociales</strong> ${fuente(datos.meta.conflictos)}</div>`);
  if (activas.has("concesiones"))
    partes.push(`<div class="ley"><span class="sim" style="background:${COLOR_CONCESION};opacity:.5"></span><strong>Concesiones mineras vigentes</strong>
      ${fuente(datos.meta.concesiones)}</div>`);
  if (activas.has("salud"))
    partes.push(`<div class="ley"><strong>Establecimientos de salud</strong>
      <div class="escala"><span><i style="background:${COLOR_SALUD_PUBLICO}"></i>público</span><span><i style="background:${COLOR_SALUD_PRIVADO}"></i>privado</span></div>
      ${fuente(datos.meta.salud)}</div>`);
  if (activas.has("calor"))
    partes.push(`<div class="ley"><span class="sim calor"></span><strong>Concentración de noticias</strong>
      <span class="fuente">Según los filtros de período, tema y medio</span></div>`);
  return partes.join("");
}

export function fichaLugar(titulo: string, subtitulo: string, ns: Noticia[], temas: Map<string, Tema>): string {
  return `
    <h2>${escapar(titulo)}</h2>
    <p class="ruta">${escapar(subtitulo)}</p>
    ${listaNoticias(ns, temas)}`;
}
