"""Validación de las capas generadas por los ETL (las que publica la web) y de la lógica de los ETL.

Si fallan después de correr un ETL, NO publicar: ver RUNBOOK.md › "El ETL de una fuente falló".
"""
import json

import pytest

from etl.common import LAYERS_DIR, ROOT
from etl.concesiones.run import titular_publico
from etl.conflictos.run import casos

PERU = (-81.5, -18.5, -68.5, 0.1)
UBIGEOS = {d["ubigeo"] for d in json.loads((ROOT / "data/gazetteer/ubigeos.json").read_text(encoding="utf-8"))}


def _cargar(nombre):
    ruta = LAYERS_DIR / nombre
    if not ruta.exists():
        pytest.skip(f"{nombre} no generado todavía")
    return json.loads(ruta.read_text(encoding="utf-8"))


def _en_peru(lon, lat):
    o, s, e, n = PERU
    return o <= lon <= e and s <= lat <= n


def test_meta_de_cada_capa():
    for capa in ("pobreza", "conflictos", "concesiones", "salud"):
        m = _cargar(f"{capa}.meta.json")
        for campo in ("fuente", "url", "fecha_corte", "fecha_carga", "visualizacion", "registros"):
            assert m.get(campo), (capa, campo)


def test_pobreza():
    d = _cargar("pobreza.json")
    assert len(d) == 1874
    for ub, v in d.items():
        assert len(ub) == 6 and ub.isdigit()
        inf, sup, medio = v[:3]
        assert 0 <= inf <= medio <= sup <= 100, (ub, v)
    cortes = _cargar("pobreza.meta.json")["estilo"]["cortes"]
    assert cortes == sorted(cortes) and len(cortes) == 4


def test_salud():
    d = _cargar("salud.geojson")["features"]
    assert len(d) >= 15_000
    for f in d[:2000]:
        lon, lat = f["geometry"]["coordinates"]
        assert _en_peru(lon, lat)
        assert f["properties"]["u"] in UBIGEOS or len(f["properties"]["u"]) == 6
        assert f["properties"]["p"] in (0, 1)


def test_conflictos():
    d = _cargar("conflictos.geojson")["features"]
    assert len(d) >= 40
    for f in d:
        assert _en_peru(*f["geometry"]["coordinates"])
        p = f["properties"]
        assert p["codigo"] and p["lugar"]
        assert all(u in UBIGEOS for u in p["distritos"])


def test_concesiones_resumen():
    centros = _cargar("concesiones_centros.json")
    assert len(centros) >= 50_000
    assert all(_en_peru(c[0], c[1]) for c in centros[:5000])
    por_distrito = _cargar("concesiones_distritos.json")
    assert set(por_distrito) <= UBIGEOS
    assert all(n > 0 and 0 <= pct <= 100.5 for n, pct in por_distrito.values())


@pytest.mark.parametrize("titular,esperado", [
    ("MINERA LAS BAMBAS S.A.", "Minera Las Bambas S.A."),
    ("COMPAÑIA DE MINAS BUENAVENTURA S.A.A.", "Compañia De Minas Buenaventura S.A.A."),
    ("JUAN PEREZ QUISPE", "Persona natural"),
    ("", ""),
])
def test_titular_protege_personas_naturales(titular, esperado):
    assert titular_publico(titular) == esperado


def test_parser_de_casos_de_la_defensoria():
    texto = """
Código: 0847-0713
Tipo: Socioambiental.
Ingresó como caso nuevo: Julio de 2013.
Caso: Los pobladores del distrito de Ocuviri acusan a la empresa minera de afectar el río Chacapalca.
Ubicación: Distrito de Ocuviri, provincia de Lampa, departamento de Puno.
Actores primarios: Frente de Defensa.
HAY DIÁLOGO
"""
    c = casos(texto)
    assert len(c) == 1
    assert c[0]["codigo"] == "0847-0713"
    assert c[0]["tipo"] == "Socioambiental"
    assert c[0]["principal"]["nombre"] == "Ocuviri"
    assert c[0]["distritos"] == [c[0]["principal"]["ubigeo"]]
    assert c[0]["dialogo"] == "Hay diálogo"
