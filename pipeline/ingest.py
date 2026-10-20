"""Ingesta de noticias: RSS → limpiar → deduplicar → ubicar → clasificar → archivos por día.

Uso:  python -m pipeline.ingest              (lo corre GitHub Actions: programado cada hora)
      python -m pipeline.ingest --solo rpp   (probar un medio)

Archivos que escribe (ver CLAUDE.md › Formato de datos):
  data/news/AAAA-MM-DD.json     noticias UBICADAS de ese día (hora de Lima). Las publica la web.
  data/news/index.json          lista de días disponibles (últimos 90) y cuántas noticias tiene cada uno
  data/pending/AAAA-MM-DD.json  noticias sin lugar o con confianza baja (no se publican; Fase 5: IA)
  data/state/vistos.json        URLs y titulares ya procesados (10 días) para no repetir
  data/status/estado.json       última ejecución y estado de cada medio (lo lee la web y el chequeo de salud)
"""
from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import re
import sys
import time
import urllib.robotparser
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from zoneinfo import ZoneInfo

import feedparser
import requests

from pipeline.fuentes import ROOT, medios, pistas_departamento, seccion_excluida, titulo_excluido
from pipeline.geoparse import geoparse
from pipeline.temas import clasificar
from pipeline.textnorm import limpiar_html, norm, recortar

LIMA = ZoneInfo("America/Lima")
USER_AGENT = "mapa-noticias-peru/1.0 (+https://github.com/renew1396/mapa-noticias-peru)"
NEWS = ROOT / "data" / "news"
PENDING = ROOT / "data" / "pending"
ARCHIVE = ROOT / "data" / "archive"
STATE = ROOT / "data" / "state" / "vistos.json"
ESTADO = ROOT / "data" / "status" / "estado.json"

DIAS_PUBLICADOS = 90     # la web solo ve los últimos 90 días
DIAS_PENDIENTES = 30
DIAS_VISTOS = 10
UMBRAL_MAPA = 0.35       # confianza mínima para mostrar la noticia en el mapa
UMBRAL_REVISAR = 0.6     # por debajo: se marca para revisión con IA (Fase 5)
SIMILITUD_GRUPO = 0.6    # títulos casi iguales en distintos medios = misma noticia

PARAMS_BASURA = re.compile(r"^(utm_|fbclid|gclid|ref$|ref_|outputType|cmp|mc_)")


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def url_canonica(url: str) -> str:
    p = urlparse(url.strip())
    query = urlencode([(k, v) for k, v in parse_qsl(p.query) if not PARAMS_BASURA.match(k)])
    ruta = p.path.rstrip("/") or "/"
    return urlunparse(("https", p.netloc.lower().removeprefix("www."), ruta, "", query, ""))


def hash_corto(texto: str) -> str:
    return hashlib.sha1(texto.encode("utf-8")).hexdigest()[:12]


def palabras_titulo(titulo: str) -> set[str]:
    return {w for w in norm(titulo).split() if len(w) > 3}


def _leer(ruta: Path, defecto):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return defecto


def _escribir(ruta: Path, obj) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(ruta)


class Robots:
    """Respeta robots.txt de cada sitio (si no se puede leer, se asume permitido)."""

    def __init__(self) -> None:
        self.cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    def permite(self, url: str) -> bool:
        host = urlparse(url).scheme + "://" + urlparse(url).netloc
        if host not in self.cache:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = requests.get(host + "/robots.txt", timeout=15, headers={"User-Agent": USER_AGENT})
                if r.status_code >= 400:
                    self.cache[host] = None
                else:
                    rp.parse(r.text.splitlines())
                    self.cache[host] = rp
            except requests.RequestException:
                self.cache[host] = None
        rp = self.cache[host]
        return True if rp is None else rp.can_fetch(USER_AGENT, url)


def fecha_entrada(e, hoy: datetime) -> datetime:
    for campo in ("published_parsed", "updated_parsed"):
        t = e.get(campo)
        if t:
            dt = datetime.fromtimestamp(calendar.timegm(t), tz=timezone.utc)
            return min(dt, hoy)  # fechas en el futuro (zonas horarias mal puestas) → ahora
    return hoy


def leer_medio(m: dict, robots: Robots) -> tuple[list, str | None]:
    if not robots.permite(m["url"]):
        return [], "robots.txt no permite leer el feed"
    try:
        r = requests.get(m["url"], timeout=30, headers={"User-Agent": USER_AGENT})
    except requests.RequestException as e:
        return [], f"sin respuesta: {type(e).__name__}"
    if r.status_code != 200:
        return [], f"HTTP {r.status_code}"
    d = feedparser.parse(r.content)
    if not d.entries:
        return [], "feed vacío o con formato inválido"
    return d.entries, None


def procesar(solo: str | None = None) -> dict:
    hoy = ahora()
    vistos: dict[str, str] = _leer(STATE, {})
    estado_prev = _leer(ESTADO, {})
    por_medio_prev = estado_prev.get("medios", {})
    robots = Robots()

    dias_news: dict[str, list] = {}
    dias_pend: dict[str, list] = {}

    def dia(lista: dict, carpeta: Path, fecha: str) -> list:
        if fecha not in lista:
            lista[fecha] = _leer(carpeta / f"{fecha}.json", {"noticias": []})["noticias"]
        return lista[fecha]

    # Títulos recientes para agrupar la misma noticia publicada por varios medios.
    recientes: list[tuple[set[str], dict]] = []
    for delta in (0, 1, 2):
        f = (hoy.astimezone(LIMA) - timedelta(days=delta)).strftime("%Y-%m-%d")
        for n in dia(dias_news, NEWS, f):
            recientes.append((palabras_titulo(n["titulo"]), n))

    medios_estado = {}
    total_nuevas = total_ubicadas = total_pend = 0
    for m in medios():
        if solo and m["id"] != solo:
            continue
        prev = por_medio_prev.get(m["id"], {})
        entradas, error = leer_medio(m, robots)
        nuevas = ubicadas = 0
        for e in entradas:
            url = e.get("link") or ""
            titulo = limpiar_html(e.get("title") or "")
            if not url or titulo_excluido(titulo) or seccion_excluida(url):
                continue
            k_url, k_tit = "u:" + hash_corto(url_canonica(url)), "t:" + hash_corto(norm(titulo))
            if k_url in vistos or k_tit in vistos:
                continue
            fecha = fecha_entrada(e, hoy)
            vistos[k_url] = vistos[k_tit] = iso(hoy)
            if hoy - fecha > timedelta(days=DIAS_PUBLICADOS):
                continue
            resumen = recortar(limpiar_html(e.get("summary") or e.get("description") or ""), 300)
            lugares = geoparse(titulo, resumen, pistas_departamento(m["id"], url))
            principal = next((x for x in lugares if x["principal"]), None)
            noticia = {
                "id": hash_corto(url_canonica(url)),
                "titulo": titulo,
                "resumen": resumen,
                "medio": m["nombre"],
                "medio_id": m["id"],
                "url": url,
                "fecha": iso(fecha),
                "temas": clasificar(titulo, resumen),
                "lugares": lugares,
            }
            pal = palabras_titulo(titulo)
            for otras, n in recientes:
                if pal and otras and len(pal & otras) / len(pal | otras) >= SIMILITUD_GRUPO:
                    noticia["grupo"] = n.get("grupo", n["id"])
                    break
            fecha_lima = fecha.astimezone(LIMA).strftime("%Y-%m-%d")
            nuevas += 1
            if principal and principal["confianza"] >= UMBRAL_MAPA:
                if principal["confianza"] < UMBRAL_REVISAR:
                    noticia["revisar"] = True
                dia(dias_news, NEWS, fecha_lima).append(noticia)
                recientes.append((pal, noticia))
                ubicadas += 1
            else:
                dia(dias_pend, PENDING, fecha_lima).append(noticia)
        total_nuevas += nuevas
        total_ubicadas += ubicadas
        total_pend += nuevas - ubicadas
        medios_estado[m["id"]] = {
            "nombre": m["nombre"],
            "ok": error is None,
            "error": error,
            "items_en_feed": len(entradas),
            "nuevas": nuevas,
            "ubicadas": ubicadas,
            "ultimo_ok": iso(hoy) if error is None else prev.get("ultimo_ok"),
            "fallos_seguidos": 0 if error is None else prev.get("fallos_seguidos", 0) + 1,
        }
        time.sleep(0.5)  # cortesía con los servidores

    for fecha, lista in dias_news.items():
        if lista:
            lista.sort(key=lambda n: n["fecha"], reverse=True)
            _escribir(NEWS / f"{fecha}.json", {"fecha": fecha, "noticias": lista})
    for fecha, lista in dias_pend.items():
        if lista:
            lista.sort(key=lambda n: n["fecha"], reverse=True)
            _escribir(PENDING / f"{fecha}.json", {"fecha": fecha, "noticias": lista})

    archivar(hoy)
    escribir_temas()
    limite = iso(hoy - timedelta(days=DIAS_VISTOS))
    _escribir(STATE, {k: v for k, v in sorted(vistos.items()) if v >= limite})
    escribir_indice(hoy)

    if solo:  # en pruebas de un solo medio se conservan los demás
        medios_estado = {**por_medio_prev, **medios_estado}
    estado = {
        "ultima_ejecucion": iso(hoy),
        "ultima_noticia_nueva": iso(hoy) if total_nuevas else estado_prev.get("ultima_noticia_nueva"),
        "nuevas": total_nuevas,
        "ubicadas": total_ubicadas,
        "pendientes": total_pend,
        "medios": medios_estado,
    }
    _escribir(ESTADO, estado)
    return estado


def archivar(hoy: datetime) -> None:
    """Mueve a data/archive/ los días que ya no se publican (no se borra nada)."""
    hoy_lima = hoy.astimezone(LIMA).date()
    for carpeta, dias, destino in ((NEWS, DIAS_PUBLICADOS, ARCHIVE / "news"),
                                   (PENDING, DIAS_PENDIENTES, ARCHIVE / "pending")):
        for f in carpeta.glob("????-??-??.json"):
            fecha = datetime.strptime(f.stem, "%Y-%m-%d").date()
            if (hoy_lima - fecha).days > dias:
                (destino / f.stem[:4]).mkdir(parents=True, exist_ok=True)
                f.replace(destino / f.stem[:4] / f.name)


def escribir_temas() -> None:
    """Copia nombres y colores de los temas para la web (la web no lee YAML)."""
    from pipeline.temas import temas
    _escribir(ROOT / "data" / "status" / "temas.json",
              [{"clave": k, "nombre": t["nombre"], "color": t["color"]} for k, t in temas().items()])


def escribir_indice(hoy: datetime) -> None:
    dias = []
    for f in sorted(NEWS.glob("????-??-??.json"), reverse=True):
        n = len(_leer(f, {"noticias": []})["noticias"])
        dias.append({"fecha": f.stem, "n": n})
    _escribir(NEWS / "index.json", {"actualizado": iso(hoy), "dias": dias})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--solo", help="procesar solo este medio (id de config/sources.yaml)")
    args = ap.parse_args()
    e = procesar(args.solo)
    caidos = [f"{v['nombre']} ({v['error']})" for v in e["medios"].values() if not v["ok"]]
    print(f"Nuevas: {e['nuevas']} · ubicadas en el mapa: {e['ubicadas']} · sin ubicar: {e['pendientes']}")
    if caidos:
        print("Medios con problemas en esta ejecución: " + "; ".join(caidos))
    return 0


if __name__ == "__main__":
    sys.exit(main())
