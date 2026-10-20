// Avisos breves en pantalla (en vez de alert()) y estado de la conexión.

export type TipoAviso = "info" | "error" | "ok";

let contenedor: HTMLElement | null = null;

function caja(): HTMLElement {
  if (!contenedor) {
    contenedor = document.createElement("div");
    contenedor.className = "avisos";
    contenedor.setAttribute("role", "status");
    contenedor.setAttribute("aria-live", "polite");
    document.body.appendChild(contenedor);
  }
  return contenedor;
}

/** Muestra un aviso que desaparece solo (los de error duran más). Repetir el mismo texto no lo duplica. */
export function avisar(texto: string, tipo: TipoAviso = "info", ms = tipo === "error" ? 9000 : 4500) {
  const c = caja();
  if ([...c.children].some((n) => n.textContent === texto)) return;
  const el = document.createElement("div");
  el.className = `aviso aviso-${tipo}`;
  el.textContent = texto;
  el.addEventListener("click", () => el.remove());
  c.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Avisa cuando el celular se queda sin internet y cuando vuelve. */
export function vigilarConexion() {
  window.addEventListener("offline", () =>
    avisar("Sin conexión a internet: verás lo que ya estaba cargado. Las capas nuevas no se podrán abrir.", "error", 12000));
  window.addEventListener("online", () => avisar("Conexión recuperada.", "ok"));
  if (!navigator.onLine) avisar("Sin conexión a internet: se muestran los datos guardados de tu última visita.", "error", 12000);
}
