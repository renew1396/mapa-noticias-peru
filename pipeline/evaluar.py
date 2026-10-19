"""Evalúa el geoparsing contra el set etiquetado a mano (data/eval/set.jsonl).

Métricas (sobre noticias cuyo lugar esperado existe):
  - ubicadas: el sistema propuso un lugar principal
  - correctas a nivel departamento: el departamento del lugar principal coincide
  - correctas a nivel distrito: solo sobre noticias cuyo lugar esperado es un distrito o centro poblado;
    el lugar principal debe estar en ese mismo distrito
Y sobre las noticias SIN lugar esperado: falsos positivos (el sistema puso un lugar).

Uso:  python -m pipeline.evaluar            (imprime el reporte; en GitHub también va al resumen)
      python -m pipeline.evaluar --detalle  (lista cada error)
"""
from __future__ import annotations

import json
import os
import sys

from pipeline.fuentes import pistas_departamento, titulo_excluido
from pipeline.geoparse import geoparse

ROOT_SET = os.path.join(os.path.dirname(__file__), "..", "data", "eval", "set.jsonl")
UMBRAL = 0.35  # por debajo de esta confianza la noticia no se muestra en el mapa


def principal(lugares: list[dict]) -> dict | None:
    p = next((x for x in lugares if x["principal"]), None)
    return p if p and p["confianza"] >= UMBRAL else None


def evaluar(ruta: str = ROOT_SET) -> dict:
    filas = [json.loads(l) for l in open(ruta, encoding="utf-8") if l.strip()]
    r = {"total": len(filas), "con_lugar": 0, "ubicadas": 0, "ok_dep": 0, "con_distrito": 0, "ok_dist": 0,
         "sin_lugar": 0, "falsos_positivos": 0, "errores": []}
    for f in filas:
        pred = None if titulo_excluido(f["titulo"]) else principal(
            geoparse(f["titulo"], f["resumen"], pistas_departamento(f["medio"], f["url"])))
        esp = f["esperado"]
        if esp is None:
            r["sin_lugar"] += 1
            if pred:
                r["falsos_positivos"] += 1
                r["errores"].append((f["id"], "falso positivo", f["titulo"], None, pred))
            continue
        r["con_lugar"] += 1
        if not pred:
            r["errores"].append((f["id"], "no ubicada", f["titulo"], esp, None))
            continue
        r["ubicadas"] += 1
        ok_dep = pred["ubigeo"][:2] == esp["ubigeo"][:2]
        r["ok_dep"] += ok_dep
        if esp["precision"] in ("distrito", "centro_poblado"):
            r["con_distrito"] += 1
            ok = pred["precision"] in ("distrito", "centro_poblado") and pred["ubigeo"] == esp["ubigeo"]
            r["ok_dist"] += ok
            if not ok:
                r["errores"].append((f["id"], "distrito incorrecto", f["titulo"], esp, pred))
        elif not ok_dep:
            r["errores"].append((f["id"], "departamento incorrecto", f["titulo"], esp, pred))
    return r


def pct(a: int, b: int) -> str:
    return f"{100 * a / b:.0f} %" if b else "—"


def reporte(r: dict, detalle: bool) -> str:
    lineas = [
        "## Evaluación del geoparsing (Nivel 1, sin IA)",
        "",
        f"Set de prueba: **{r['total']}** noticias ({r['con_lugar']} con lugar esperado, {r['sin_lugar']} sin lugar).",
        "",
        "| Métrica | Resultado |",
        "|---|---|",
        f"| Ubicadas (de las que tienen lugar) | {r['ubicadas']}/{r['con_lugar']} = {pct(r['ubicadas'], r['con_lugar'])} |",
        f"| Correctas a nivel departamento | {r['ok_dep']}/{r['con_lugar']} = {pct(r['ok_dep'], r['con_lugar'])} |",
        f"| **Correctas a nivel distrito** (meta ≥ 80 %) | {r['ok_dist']}/{r['con_distrito']} = "
        f"**{pct(r['ok_dist'], r['con_distrito'])}** |",
        f"| Falsos positivos (noticias sin lugar a las que se puso uno) | {r['falsos_positivos']}/{r['sin_lugar']} = "
        f"{pct(r['falsos_positivos'], r['sin_lugar'])} |",
    ]
    if detalle and r["errores"]:
        lineas += ["", "### Errores", "", "| id | tipo | titular | esperado | obtenido |", "|---|---|---|---|---|"]
        for id_, tipo, tit, esp, pred in r["errores"]:
            e = f"{esp['nombre']} ({esp['ubigeo']})" if esp else "—"
            p = f"{pred['nombre']} ({pred['ubigeo']}, {pred['precision']}, {pred['confianza']})" if pred else "—"
            lineas.append(f"| {id_} | {tipo} | {tit[:70].replace('|', '/')} | {e} | {p} |")
    return "\n".join(lineas) + "\n"


def main() -> int:
    r = evaluar()
    texto = reporte(r, detalle=True if os.environ.get("GITHUB_STEP_SUMMARY") else "--detalle" in sys.argv)
    print(texto)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(texto)
    return 0


if __name__ == "__main__":
    sys.exit(main())
