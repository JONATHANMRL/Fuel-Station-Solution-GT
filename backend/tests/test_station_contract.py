import json
import unittest
from copy import deepcopy
from decimal import Decimal

from backend.station_contract import InvalidSnapshot, build_brands, build_prices, build_stations
from backend.tests.fixtures import snapshot


class StationContractTests(unittest.TestCase):
    def test_75_rows_group_into_25_stations_without_assuming_sequential_ids(self):
        stations = build_stations(snapshot())
        self.assertEqual(len(stations), 25)
        self.assertEqual(len({station['id'] for station in stations}), 25)
        self.assertEqual(stations[-1]['id'], '40')
        self.assertNotIn('6', [station['id'] for station in stations])
        self.assertTrue(all(isinstance(station['id'], str) for station in stations))

    def test_react_keys_numbers_and_null_dates_are_json_serializable(self):
        stations = json.loads(json.dumps(build_stations(snapshot()), allow_nan=False))
        station = stations[0]
        self.assertEqual(station['prices'], {'premium': 32.25, 'regular': 31.25, 'diesel': 33.25})
        self.assertIsInstance(station['lat'], float)
        self.assertIsNone(station['updatedAt'])
        self.assertEqual(station['zone'], 'Zona 1')
        self.assertEqual(station['source'], 'oracle')
        self.assertFalse(station['isDemo'])

    def test_oracle_coordinates_are_not_automatically_verified(self):
        self.assertTrue(all(station['locationStatus'] == 'pending'
                            for station in build_stations(snapshot())))

    def test_missing_and_invalid_coordinates_keep_station_and_clear_coordinate_pair(self):
        rows = snapshot()
        rows.locations[0]['LATITUD'] = None
        rows.locations[1]['LONGITUD'] = Decimal('181')
        rows.locations[2]['LATITUD'] = Decimal('NaN')
        for station in build_stations(rows)[:3]:
            self.assertIsNone(station['lat'])
            self.assertIsNone(station['lng'])

    def test_station_without_any_prices_survives_left_join_with_three_null_keys(self):
        rows = snapshot()
        rows.price_rows[:] = rows.price_rows[3:]
        rows.map_rows[:] = rows.map_rows[3:]
        rows.map_rows.append({'ID_GASOLINERA': 1, 'MARCA': 'Shell', 'ID_COMBUSTIBLE': None})
        station = build_stations(rows)[0]
        self.assertEqual(len(build_stations(rows)), 25)
        self.assertEqual(station['prices'], dict.fromkeys(('premium', 'regular', 'diesel')))
        self.assertEqual(set(station['availability'].values()), {'NO_REGISTRADO'})

    def test_exhausted_fuel_retains_price_and_is_not_marked_available(self):
        rows = snapshot()
        rows.price_rows[0]['DISPONIBILIDAD'] = rows.map_rows[0]['DISPONIBILIDAD'] = 'AGOTADO'
        stations = build_stations(rows)
        regular = build_prices(stations, 'regular')[0]
        self.assertEqual(regular['price'], 31.25)
        self.assertEqual(regular['availability'], 'AGOTADO')
        self.assertFalse(regular['available'])

    def test_inactive_station_prices_are_not_available(self):
        rows = snapshot()
        rows.locations[0]['ESTADO'] = 'INACTIVA'
        prices = build_prices(build_stations(rows))
        self.assertTrue(all(not price['available'] for price in prices if price['stationId'] == '1'))

    def test_price_list_and_fuel_filter(self):
        stations = build_stations(snapshot())
        self.assertEqual(len(build_prices(stations)), 75)
        self.assertEqual(len(build_prices(stations, 'diesel')), 25)
        self.assertEqual({price['fuel'] for price in build_prices(stations, 'diesel')}, {'diesel'})
        with self.assertRaises(ValueError):
            build_prices(stations, 'invalid')

    def test_seven_brands_keep_legacy_count_field(self):
        brands = build_brands(build_stations(snapshot()))
        self.assertEqual(len(brands), 7)
        self.assertEqual(sum(brand['count'] for brand in brands), 25)
        self.assertTrue(all(brand['stations'] == brand['count'] for brand in brands))

    def test_empty_database_returns_empty_collections(self):
        rows = snapshot()
        rows.locations.clear()
        rows.map_rows.clear()
        rows.price_rows.clear()
        self.assertEqual(build_stations(rows), [])

    def test_missing_brand_and_zone_have_explicit_fallbacks(self):
        rows = snapshot()
        rows.locations[0]['DIRECCION'] = 'Aldea sin zona confirmada'
        for row in rows.map_rows[:3]:
            row['MARCA'] = None
        station = build_stations(rows)[0]
        self.assertEqual(station['brand'], 'Independiente')
        self.assertEqual(station['zone'], 'Por verificar')

    def test_inconsistent_views_or_duplicate_pairs_are_rejected(self):
        for mutation in ('price', 'duplicate', 'missing', 'brand', 'fuel'):
            with self.subTest(mutation=mutation):
                rows = snapshot()
                if mutation == 'price':
                    rows.price_rows[0]['PRECIO_ACTUAL'] = Decimal('99')
                elif mutation == 'duplicate':
                    rows.price_rows.append(dict(rows.price_rows[0]))
                elif mutation == 'missing':
                    rows.map_rows.pop()
                elif mutation == 'brand':
                    rows.map_rows[1]['MARCA'] = 'Otra marca'
                else:
                    rows.price_rows[0]['COMBUSTIBLE'] = 'Superior'
                with self.assertRaises(InvalidSnapshot):
                    build_stations(rows)

    def test_invalid_prices_are_not_rounded_or_passed_as_nan(self):
        for invalid in (Decimal('NaN'), Decimal('Infinity'), Decimal('-1'), Decimal('0'),
                        Decimal('1.001'), Decimal('1000000')):
            with self.subTest(value=invalid):
                rows = snapshot()
                rows.map_rows[0]['PRECIO_ACTUAL'] = rows.price_rows[0]['PRECIO_ACTUAL'] = invalid
                with self.assertRaises(InvalidSnapshot):
                    build_stations(rows)

    def test_adapter_does_not_mutate_source_rows(self):
        rows = snapshot()
        before = deepcopy(rows)
        build_stations(rows)
        self.assertEqual(rows, before)


if __name__ == '__main__':
    unittest.main()
