import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_MARKER_COLOR, getMapBrandStyle, getMapMarkerStyle, getVisibleBrandLegend } from '../src/config/mapBrandStyles.js'

test('requested brands have their configured colors', () => {
  for (const [brand, color] of [
    ['Shell', '#F5C400'], ['Puma Energy', '#D9272E'], ['Texaco', '#E32636'],
    ['Pegaso', '#1769C2'], ['Mobil', '#244A9B'], ['Independiente', '#64748B'],
  ]) assert.equal(getMapBrandStyle(brand).color, color)
})

test('brand resolution accepts case, whitespace and Puma aliases', () => {
  for (const value of ['Puma', ' puma ENERGY ', '\tPUMA\nEnergy', 'P U M A E N E R G Y']) {
    assert.equal(getMapBrandStyle(value).key, 'puma')
    assert.equal(getMapBrandStyle(value).color, '#D9272E')
  }
  assert.equal(getMapBrandStyle(' sHeLl ').color, '#F5C400')
  assert.equal(getMapBrandStyle('DON  ARTURO').key, 'donarturo')
  assert.equal(getMapBrandStyle('gasolineras independientes').color, DEFAULT_MARKER_COLOR)
})

test('unconfigured brands and missing values use gray', () => {
  for (const value of ['Unconfigured brand', 'METRO', '', null, undefined, 42]) {
    assert.equal(getMapBrandStyle(value).color, '#64748B')
  }
})

test('selection preserves brand color and uses consistent marker dimensions', () => {
  for (const brand of ['Shell', 'Puma', 'Texaco', 'Don Arturo', 'Unknown']) {
    const standard = getMapMarkerStyle(brand)
    const selected = getMapMarkerStyle(brand, true)
    assert.equal(standard.radius, 9)
    assert.equal(standard.pathOptions.weight, 2)
    assert.equal(standard.pathOptions.color, '#ffffff')
    assert.equal(selected.radius, 12)
    assert.equal(selected.pathOptions.weight, 4)
    assert.equal(selected.pathOptions.color, '#123047')
    assert.equal(selected.pathOptions.fillColor, standard.pathOptions.fillColor)
  }
})

test('legend contains only visible coordinates and merges brand aliases', () => {
  const stations = [
    { brand: 'Puma', lat: 15.31, lng: -91.47 },
    { brand: ' puma ENERGY ', lat: 15.32, lng: -91.48 },
    { brand: 'Shell', lat: 15.33, lng: -91.49 },
    { brand: 'Pegaso', lat: null, lng: null },
    { brand: 'Texaco', lat: 15.5, lng: -91.7 },
  ]
  const before = JSON.stringify(stations)
  const legend = getVisibleBrandLegend(stations, (station) => station.lat < 15.4)
  assert.deepEqual(legend.map((brand) => brand.label), ['Puma Energy', 'Shell'])
  assert.equal(legend[0].color, '#D9272E')
  assert.equal(JSON.stringify(stations), before)
  assert.deepEqual(getVisibleBrandLegend([]), [])
  assert.deepEqual(getVisibleBrandLegend(stations, () => false), [])
})

test('filtered station sets keep the same marker colors', () => {
  const stations = [{ brand: 'Shell', lat: 15.3, lng: -91.4 }, { brand: 'Texaco', lat: 15.31, lng: -91.41 }]
  const selectedBrand = stations.filter((station) => station.brand === 'Texaco')
  assert.deepEqual(getVisibleBrandLegend(selectedBrand), [{ key: 'texaco', label: 'Texaco', color: '#E32636' }])
  assert.equal(getMapMarkerStyle(selectedBrand[0].brand).pathOptions.fillColor, '#E32636')
})
