from decimal import Decimal

from backend.station_contract import OracleSnapshot


def snapshot() -> OracleSnapshot:
    """25 synthetic stations / 75 prices, with the non-contiguous Oracle ID shape."""
    ids = [1, 2, 3, 4, 5, *range(21, 41)]
    brands = ['Shell', 'Puma Energy', 'Texaco', 'Pegaso', 'Metro', 'Don Arturo', 'UNO']
    locations, map_rows, prices = [], [], []
    for index, station_id in enumerate(ids):
        locations.append({
            'ID_GASOLINERA': Decimal(station_id), 'GASOLINERA': f'Estación SIMULADA {station_id}',
            'DIRECCION': f'Zona {index % 12 + 1}, dirección SIMULADA',
            'MUNICIPIO': 'Municipio de prueba', 'DEPARTAMENTO': 'Departamento de prueba',
            'LATITUD': Decimal('15.3'), 'LONGITUD': Decimal('-91.4'), 'ESTADO': 'ACTIVA',
        })
        for fuel_id, name in [(1, 'Regular'), (2, 'Superior'), (3, 'Diésel')]:
            price = {
                'ID_GASOLINERA': Decimal(station_id), 'ID_COMBUSTIBLE': Decimal(fuel_id),
                'COMBUSTIBLE': name, 'PRECIO_ACTUAL': Decimal('30.25') + fuel_id,
                'DISPONIBILIDAD': 'DISPONIBLE',
            }
            prices.append(price)
            map_rows.append({**price, 'MARCA': brands[index % len(brands)]})
    return OracleSnapshot(locations, map_rows, prices)
