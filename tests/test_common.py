import pytest

from etl.common import EtlError, require_fields, ubigeo6


@pytest.mark.parametrize("entrada,esperado", [
    ("150101", "150101"),
    (150101, "150101"),
    (10101, "010101"),      # Chachapoyas: el cero inicial se pierde si viene como número
    ("10101", "010101"),
    (10101.0, "010101"),
    (" 080918 ", "080918"),
])
def test_ubigeo6_normaliza(entrada, esperado):
    assert ubigeo6(entrada) == esperado


@pytest.mark.parametrize("malo", [None, "", "1501", "1501011", "15O101", "abc"])
def test_ubigeo6_rechaza_invalidos(malo):
    with pytest.raises(EtlError):
        ubigeo6(malo)


def test_require_fields_explica_lo_que_falta():
    with pytest.raises(EtlError, match="faltan columnas"):
        require_fields({"UBIGEO": 1}, ["UBIGEO", "nombdist"], "Prueba")
    require_fields({"UBIGEO": 1, "nombdist": "x"}, ["UBIGEO", "nombdist"], "Prueba")
