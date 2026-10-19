"""Comportamientos esperados del geoparsing Nivel 1. Si cambias reglas, estos casos deben seguir pasando."""
import pytest

from pipeline.evaluar import evaluar
from pipeline.geoparse import geoparse

PERU = (-81.5, -18.5, -68.5, 0.1)


def principal(titulo, resumen="", pistas=None):
    lugares = geoparse(titulo, resumen, pistas)
    p = next((x for x in lugares if x["principal"]), None)
    return p if p and p["confianza"] >= 0.35 else None


@pytest.mark.parametrize("titulo,resumen,pistas,ubigeo", [
    # formato "Lugar: …" del titular, nombre que también es palabra común
    ("Independencia: menor de 12 años desaparece cuando estaba en el cine con su padre", "", None, "150112"),
    # el lugar más específico dentro de la región/provincia mencionadas
    ("Puno: en la provincia de Melgar nevados de Vilcanota se extinguen y falta agua",
     "La alarma crece en Santa Rosa, Melgar ya que la población alerta", None, "210808"),
    ("Arequipa: bonito alcanza los S/9 por kilo en el terminal pesquero",
     "En mesa de venta, en el distrito de Cerro Colorado, Arequipa.", None, "040104"),
    # "en X" pesa más que "desde Y"
    ("Ministro anuncia obras", "El ministro, desde Lima, anunció obras en Vinchos.", None, "050114"),
    # la pista de región del medio desempata nombres repetidos
    ("Comisaría de San Rafael recibe nuevos patrulleros", "", ["10"], "100207"),
    # alias: ciudad cuyo distrito se llama distinto
    ("Pucallpa: vecinos denuncian falta de agua", "", None, "250101"),
])
def test_ubica(titulo, resumen, pistas, ubigeo):
    p = principal(titulo, resumen, pistas)
    assert p is not None, titulo
    assert p["ubigeo"] == ubigeo, (titulo, p)


@pytest.mark.parametrize("titulo,resumen", [
    ("En un partidazo, Alianza Lima venció 3-2 a Rebaza Acosta", ""),          # club, no lugar
    ("María Julia Caffaro: la innovación va a tener valor", ""),                # nombre de persona
    ("Fiscalía pide crédito suplementario", "Tomás Gálvez dijo que el aumento no alcanza."),
    ("Bélgica: cerca de 200 detenidos durante protestas", ""),                  # país extranjero
    ("Choque en la avenida Arequipa deja dos heridos", ""),                     # calle
    ("Minem presenta informe", "Lima, 18 de octubre de 2026.- El ministerio presentó…"),  # fecha de cabecera
    ("Resultados de elecciones", "Ganadores de las elecciones municipales en Lima y el Perú."),
    ("Celebran la victoria del equipo", "Una gran victoria para la unión del grupo."),  # palabras comunes
    ("Minería ilegal se extiende",
     "Antes era en Madre de Dios, Puno, Arequipa y La Libertad; ahora llega a Cajamarca y Amazonas."),
])
def test_no_ubica(titulo, resumen):
    assert principal(titulo, resumen) is None


def test_formato_de_salida():
    lugares = geoparse("Juliaca: desfile por el centenario", "En la Plaza de Armas de Juliaca, San Román.")
    assert lugares and lugares[0]["principal"]
    o, s, e, n = PERU
    for x in lugares:
        assert isinstance(x["ubigeo"], str) and len(x["ubigeo"]) == 6
        assert x["precision"] in ("departamento", "provincia", "distrito", "centro_poblado")
        assert 0 <= x["confianza"] <= 1
        assert o <= x["lon"] <= e and s <= x["lat"] <= n


def test_meta_de_calidad_en_set_de_prueba():
    """Guardia contra retrocesos: la meta del MVP es ≥ 80 % de aciertos a nivel distrito."""
    r = evaluar()
    assert r["con_distrito"] >= 30
    assert r["ok_dist"] / r["con_distrito"] >= 0.80
    assert r["ok_dep"] / r["con_lugar"] >= 0.85
    assert r["falsos_positivos"] / r["sin_lugar"] <= 0.15
