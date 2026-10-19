"""Comprueba los archivos de límites ya generados (los que publica la web).

Si estos tests fallan después de correr el ETL, NO publicar: ver RUNBOOK.md.
"""
import json

import pytest

from etl.common import LAYERS_DIR, ROOT

PERU = (-81.5, -18.5, -68.5, 0.1)  # oeste, sur, este, norte


def _cargar(nombre):
    ruta = LAYERS_DIR / nombre
    if not ruta.exists():
        pytest.skip(f"{nombre} no generado todavía (correr python -m etl.limites.run)")
    return json.loads(ruta.read_text(encoding="utf-8"))


def _coords(geom):
    def walk(c):
        if isinstance(c[0], (int, float)):
            yield c
        else:
            for x in c:
                yield from walk(x)
    yield from walk(geom["coordinates"])


def test_distritos_completos_y_con_ubigeo_valido():
    d = _cargar("distritos.geojson")
    ubigeos = [f["properties"]["ubigeo"] for f in d["features"]]
    assert len(ubigeos) >= 1880
    assert len(set(ubigeos)) == len(ubigeos), "ubigeos duplicados"
    assert all(isinstance(u, str) and len(u) == 6 and u.isdigit() for u in ubigeos)
    assert "150101" in ubigeos  # Lima Cercado
    assert "010101" in ubigeos  # Chachapoyas (cero inicial)
    for f in d["features"]:
        p = f["properties"]
        assert p["distrito"] and p["provincia"] and p["departamento"], p


def test_coordenadas_dentro_del_peru():
    d = _cargar("distritos.geojson")
    o, s, e, n = PERU
    for f in d["features"]:
        for lon, lat in _coords(f["geometry"]):
            assert o <= lon <= e and s <= lat <= n, (f["properties"]["ubigeo"], lon, lat)


def test_departamentos_y_meta():
    dep = _cargar("departamentos.geojson")
    assert len(dep["features"]) == 25  # 24 departamentos + Callao
    meta = _cargar("distritos.meta.json")
    for campo in ("fuente", "url", "fecha_corte", "fecha_carga", "visualizacion", "registros"):
        assert meta.get(campo), campo


def test_lista_de_ubigeos_para_gazetteer():
    ruta = ROOT / "data" / "gazetteer" / "ubigeos.json"
    if not ruta.exists():
        pytest.skip("ubigeos.json no generado")
    filas = json.loads(ruta.read_text(encoding="utf-8"))
    assert len(filas) >= 1880
    o, s, e, n = PERU
    assert all(o <= r["lon"] <= e and s <= r["lat"] <= n for r in filas)
