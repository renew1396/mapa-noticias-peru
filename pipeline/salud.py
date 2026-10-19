"""Chequeo de salud diario. Si algo falla, termina con error y GitHub avisa por correo.

Revisa:
  1. que la tarea de noticias haya corrido en las últimas 6 horas
  2. que haya entrado alguna noticia nueva en las últimas 48 horas
  3. que ningún medio lleve 24 horas o más fallando seguido (12 ejecuciones)
  4. que el sitio publicado responda y tenga el índice de noticias

Uso:  python -m pipeline.salud
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

from pipeline.ingest import ESTADO

SITIO = os.environ.get("SITIO_URL", "https://renew1396.github.io/mapa-noticias-peru/")
MAX_SIN_EJECUTAR = timedelta(hours=6)
MAX_SIN_NOTICIAS = timedelta(hours=48)
MAX_FALLOS_SEGUIDOS = 12


def _fecha(iso: str | None) -> datetime | None:
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) if iso else None


def revisar() -> tuple[list[str], list[str]]:
    problemas, avisos = [], []
    ahora = datetime.now(timezone.utc)
    try:
        estado = json.loads(ESTADO.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ["No existe data/status/estado.json: la tarea de noticias nunca corrió."], []

    ult = _fecha(estado.get("ultima_ejecucion"))
    if not ult or ahora - ult > MAX_SIN_EJECUTAR:
        problemas.append(f"La tarea de noticias no corre desde {estado.get('ultima_ejecucion')} "
                         "(ver RUNBOOK.md › 'No se actualizan las noticias').")
    nueva = _fecha(estado.get("ultima_noticia_nueva"))
    if not nueva or ahora - nueva > MAX_SIN_NOTICIAS:
        problemas.append(f"No entra ninguna noticia nueva desde {estado.get('ultima_noticia_nueva')}.")

    for id_, m in sorted(estado.get("medios", {}).items()):
        if m.get("fallos_seguidos", 0) >= MAX_FALLOS_SEGUIDOS:
            problemas.append(f"El RSS de {m['nombre']} ({id_}) falla hace {m['fallos_seguidos']} ejecuciones seguidas: "
                             f"{m.get('error')}. Último OK: {m.get('ultimo_ok')} (ver RUNBOOK.md › 'Un RSS dejó de funcionar').")
        elif not m.get("ok"):
            avisos.append(f"{m['nombre']}: falló en la última ejecución ({m.get('error')}).")

    for ruta in ("", "data/news/index.json", "data/status/estado.json"):
        try:
            r = requests.get(SITIO + ruta, timeout=30)
            if r.status_code != 200:
                problemas.append(f"El sitio no responde bien: {SITIO + ruta} → HTTP {r.status_code}.")
            elif ruta == "" and "Mapa de noticias" not in r.text:
                problemas.append("La página principal del sitio no tiene el contenido esperado.")
        except requests.RequestException as e:
            problemas.append(f"El sitio no responde: {SITIO + ruta} ({type(e).__name__}).")
    return problemas, avisos


def main() -> int:
    problemas, avisos = revisar()
    lineas = ["## Chequeo de salud", ""]
    lineas += [f"- ❌ {p}" for p in problemas] or ["- ✅ Todo funciona: noticias al día, medios respondiendo y sitio en línea."]
    if avisos:
        lineas += ["", "Avisos (no bloquean):", *[f"- ⚠️ {a}" for a in avisos]]
    texto = "\n".join(lineas) + "\n"
    print(texto)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(texto)
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
