// Página "Acerca de / Fuentes": se arma con los datos reales (meta de cada capa y estado de cada medio),
// así siempre muestra fuentes, fechas y estado actualizados sin editar texto a mano.
import { datos, type Meta } from "./capas";
import { escapar, fechaLima, haceCuanto } from "./ui";
import type { Estado } from "./tipos";

const REPO = "https://github.com/renew1396/mapa-noticias-peru";

function enlace(url: string, texto: string): string {
  let seguro = "#";
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") seguro = u.href;
  } catch { /* url inválida */ }
  return `<a href="${escapar(seguro)}" target="_blank" rel="noopener">${escapar(texto)}</a>`;
}

function filaCapa(nombre: string, m: Meta | undefined, nota: string): string {
  if (!m) return `<tr><th>${escapar(nombre)}</th><td colspan="3">Sin datos cargados todavía.</td></tr>`;
  return `<tr>
    <th>${escapar(nombre)}</th>
    <td>${enlace(m.url, m.fuente)}</td>
    <td>${escapar(m.fecha_corte)}<br><small>cargada ${escapar(m.fecha_carga.slice(0, 10))}</small></td>
    <td>${m.registros.toLocaleString("es-PE")}<br><small>${escapar(nota)}</small></td>
  </tr>`;
}

export function htmlAcerca(estado: Estado | null): string {
  const medios = estado ? Object.entries(estado.medios).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, "es")) : [];
  const caidos = medios.filter(([, m]) => !m.ok).length;
  return `
  <h2>Acerca de este mapa</h2>
  <p>Mapa del Perú que reúne <strong>noticias recientes ubicadas por lugar</strong> y <strong>datos públicos</strong>
    (pobreza, conflictos sociales, concesiones mineras y establecimientos de salud) para entender qué pasa en una zona.
    Es un proyecto personal, gratuito y sin publicidad.</p>

  <h3>Cómo se usa</h3>
  <ul>
    <li><strong>Toca el mapa</strong> para ver una zona de 1 a 50 km alrededor de ese punto, o usa <strong>Dibujar zona</strong>.</li>
    <li>En <strong>Capas</strong> prendes o apagas las capas de datos y filtras las noticias por período, tema y medio.</li>
    <li>La dirección de la página guarda la zona elegida: <strong>cópiala para compartirla</strong>.</li>
    <li>Puedes <strong>instalarlo en tu celular</strong>: en Chrome, menú › «Agregar a la pantalla principal»; en Safari, Compartir › «Agregar a inicio».</li>
  </ul>

  <h3>Noticias</h3>
  <p>Se leen varias veces al día (normalmente cada 1 a 3 horas) los RSS públicos de ${medios.length} medios. Se guarda solo el titular, un resumen corto,
    el medio, la fecha y el enlace: <strong>para leer la noticia completa entra al medio</strong>.
    ${estado ? `Última actualización: ${escapar(fechaLima(estado.ultima_ejecucion))} (${escapar(haceCuanto(estado.ultima_ejecucion))}).` : ""}</p>
  <p>El lugar de cada noticia se detecta <strong>automáticamente</strong> con los nombres oficiales de distritos y centros
    poblados del INEI. En una prueba con 129 noticias revisadas a mano acertó el distrito en el 94 % de los casos y el
    departamento en el 96 %, pero <strong>puede equivocarse</strong>: las marcadas como «ubicación dudosa» conviene verificarlas.
    Las noticias que solo mencionan una provincia o región no tienen pin y aparecen aparte en la ficha de la zona.</p>
  <details><summary>Medios (${medios.length}${caidos ? `, ${caidos} con problemas en la última lectura` : ""})</summary>
    <ul class="medios">${medios.map(([, m]) =>
      `<li>${escapar(m.nombre)} ${m.ok ? "✓" : `<span class="dudosa">— sin respuesta (${escapar(m.error ?? "error")})</span>`}</li>`).join("")}</ul>
  </details>

  <h3>Capas de datos públicos</h3>
  <div class="tabla-scroll"><table class="fuentes">
    <thead><tr><th>Capa</th><th>Fuente</th><th>Fecha del dato</th><th>Registros</th></tr></thead>
    <tbody>
      ${filaCapa("Pobreza monetaria", datos.meta.pobreza, "distritos; intervalo de confianza al 95 %")}
      ${filaCapa("Conflictos sociales", datos.meta.conflictos, "casos ubicados automáticamente desde el PDF")}
      ${filaCapa("Concesiones mineras", datos.meta.concesiones, "vigentes: tituladas y en trámite")}
      ${filaCapa("Establecimientos de salud", datos.meta.salud, "activos con coordenadas")}
      ${filaCapa("Límites distritales", datos.meta.distritos, "distritos")}
    </tbody>
  </table></div>
  <p class="nota">Centros poblados: INEI, Censo 2017. Mapa base: ${enlace("https://openfreemap.org", "OpenFreeMap")} con datos de
    ${enlace("https://www.openstreetmap.org/copyright", "OpenStreetMap")}. La pobreza 2018 es la edición distrital más reciente del INEI.</p>

  <h3>Privacidad</h3>
  <p>El mapa no usa cookies ni guarda las zonas que consultas: todos los cálculos se hacen en tu celular. No se guardan
    datos de personas: en las concesiones mineras, los titulares que parecen personas naturales se muestran como
    «Persona natural».</p>

  <h3>Código y avisos</h3>
  <p>El código y los datos procesados son públicos en ${enlace(REPO, "GitHub")}. Si ves un error de ubicación o una fuente
    caída, avísale al responsable del proyecto.</p>`;
}
