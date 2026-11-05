const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveEmployeeDistance } = require('../src/modules/distance/address-resolution');
const { createDistanceService } = require('../src/modules/distance/distance.service');
const display = 'Tòa S10.2 Origami, Phường Long Bình, Thành phố Hồ Chí Minh';
const point = { display, lat: 10.84, lng: 106.83 };
function fixture(details = point) {
  const calls = [];
  return { calls, service: {
    geocodeFull: async () => { throw new Error('Selected address must not be searched again'); },
    placeByRefId: async ref => { assert.equal(ref, 'selected-ref'); return details; },
    calculate: async input => { calls.push(input); return { distanceFromHomeKm: 12.4 }; }
  } };
}
test('Selected building without house/street/city routes using re-fetched provider coordinates', async () => {
  const f = fixture();
  const result = await resolveEmployeeDistance(display, f.service, 'selected-ref');
  assert.equal(result.status, 'READY'); assert.equal(result.distanceFromHomeKm, 12.4);
  assert.deepEqual(f.calls[0].home, { latitude: point.lat, longitude: point.lng, label: display });
});
test('Selected building rejects a different label and invalid coordinates before routing', async () => {
  for (const [address, details] of [['Another building', point], [display, { ...point, lat: 91 }],
    [display, { ...point, lng: null }], [display, { ...point, lng: -181 }]]) {
    const f = fixture(details);
    assert.equal((await resolveEmployeeDistance(address, f.service, 'selected-ref')).status, 'UNAVAILABLE');
    assert.equal(f.calls.length, 0);
  }
});
test('Unselected building text is not silently resolved, while selected street addresses still work', async () => {
  const f = fixture();
  assert.equal((await resolveEmployeeDistance(display, f.service)).reason, 'ADDRESS_NOT_MATCHED');
  const street = fixture({ hs_num: '364', street: 'Cộng Hòa', city: 'Hồ Chí Minh', lat: 10.8, lng: 106.7 });
  assert.equal((await resolveEmployeeDistance('364 Cộng Hòa, Phường 13, Hồ Chí Minh', street.service, 'selected-ref')).status, 'READY');
});
test('Selected building still requires a valid route distance', async () => {
  const f = fixture();
  f.service.calculate = async () => ({ distanceFromHomeKm: null });
  assert.equal((await resolveEmployeeDistance(display, f.service, 'selected-ref')).reason, 'INVALID_ROUTE_DISTANCE');
});
test('Vietmap suggestions expose selectable building and reject out-of-range coordinates', async () => {
  const config = { geocodingApiKey: 'fixture-key' };
  let details = point;
  const fetchImpl = async url => ({ ok: true, status: 200, json: async () => String(url).includes('/search/')
    ? [{ ref_id: 'selected-ref', display }] : details });
  const service = createDistanceService(config, fetchImpl);
  const [suggestion] = await service.search('s10.2');
  assert.equal(suggestion.isCompleteAddress, false); assert.equal(suggestion.canSelect, true);
  assert.equal(suggestion.resolvedAddress, display);
  details = { ...point, lat: 100 };
  await assert.rejects(() => service.search('s10.2'), error => error.code === 'ADDRESS_NOT_FOUND');
});
