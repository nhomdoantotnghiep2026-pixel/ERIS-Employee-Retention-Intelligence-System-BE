const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/gi, 'd').toLowerCase().replace(/\b(?:tp\.?\s*hcm|hcm)\b/g, 'ho chi minh')
  .replace(/\bho chi minh city\b/g, 'ho chi minh');
const normalize = value => fold(value)
  .replace(/\b(thanh pho|tp|tinh|quan|huyen|phuong|xa|duong|viet nam|vietnam)\b/g, ' ')
  .replace(/[^a-z0-9/]+/g, ' ').trim().replace(/\s+/g, ' ');

// Keep house/alley numbers intact. Ward/district names may use old or new administrative units.
function streetKey(value) {
  const firstPart = fold(value).split(',')[0].split(/\b(?:phuong|xa|quan|huyen|thanh pho|tinh|tp)\b/)[0];
  const key = normalize(firstPart);
  return /^\d+[a-z]?(?:\/\d+[a-z]?)*\s+\S/.test(key) ? key : null;
}
function containsCity(address, city) {
  const key = normalize(city);
  return !!key && (` ${normalize(address)} `).includes(` ${key} `);
}
const unavailable = reason => ({ distanceFromHomeKm: null, status: 'UNAVAILABLE', reason });

async function resolveEmployeeDistance(address, service, selectedRefId) {
  if (!address) return { distanceFromHomeKm: null, status: 'NOT_PROVIDED', reason: null };
  if (!service?.geocodeFull || !service?.placeByRefId || !service?.calculate) return unavailable('GEOCODING_NOT_CONFIGURED');
  const inputStreet = streetKey(address);
  if (!inputStreet) return unavailable('ADDRESS_NOT_MATCHED');
  try {
    if (selectedRefId) {
      const place = await service.placeByRefId(selectedRefId, 'home');
      if (!place.hs_num || !place.street || !place.city || normalize(place.hs_num + ' ' + place.street) !== inputStreet
        || !containsCity(address, place.city) || !Number.isFinite(place.lat) || Math.abs(place.lat) > 90
        || !Number.isFinite(place.lng) || Math.abs(place.lng) > 180) return unavailable('PLACE_DETAILS_MISMATCH');
      const route = await service.calculate({ home: { latitude: place.lat, longitude: place.lng, label: place.display || address } });
      if (!Number.isFinite(route.distanceFromHomeKm) || route.distanceFromHomeKm < 0 || route.distanceFromHomeKm > 999999.99) return unavailable('INVALID_ROUTE_DISTANCE');
      return { distanceFromHomeKm: route.distanceFromHomeKm, status: 'READY', reason: null,
        normalizedAddress: place.display || address, coordinates: { latitude: place.lat, longitude: place.lng },
        refId: selectedRefId, provider: route.provider || 'vietmap',
        addressResolution: { strategy: 'USER_SELECTED_RESULT' } };
    }
    const results = await service.geocodeFull(address);
    let hadCandidate = false;
    const visited = new Set();
    // Provider ranking is preserved. Old/new references belong to one search result, not separate votes.
    for (let index = 0; index < results.length; index++) {
      const group = [results[index], results[index]?.data_old, results[index]?.data_new].filter(Boolean);
      const aliases = group.filter(item => {
        const city = (item.boundaries || []).find(unit => unit.type === 0);
        return city && containsCity(address, city.full_name || city.name)
          && [item.name, item.address].some(value => streetKey(value) === inputStreet);
      });
      if (!aliases.length) continue;
      // Prefer the reference whose full address matches the user's old/new address, if supplied.
      aliases.sort((a, b) => Number(exactAddress(b, address)) - Number(exactAddress(a, address)));
      for (const candidate of aliases) {
        if (!candidate.ref_id || visited.has(candidate.ref_id)) continue;
        visited.add(candidate.ref_id);
        hadCandidate = true;
        const place = await service.placeByRefId(candidate.ref_id, 'home');
        if (!place.hs_num || !place.street || !place.city
          || normalize(`${place.hs_num} ${place.street}`) !== inputStreet
          || !containsCity(address, place.city)
          || !Number.isFinite(place.lat) || place.lat < -90 || place.lat > 90
          || !Number.isFinite(place.lng) || place.lng < -180 || place.lng > 180) continue;
        const route = await service.calculate({ home: { latitude: place.lat, longitude: place.lng, label: place.display || address } });
        if (!Number.isFinite(route.distanceFromHomeKm) || route.distanceFromHomeKm < 0 || route.distanceFromHomeKm > 999999.99) return unavailable('INVALID_ROUTE_DISTANCE');
        return {
          distanceFromHomeKm: route.distanceFromHomeKm, status: 'READY', reason: null,
          normalizedAddress: place.display || address, coordinates: { latitude: place.lat, longitude: place.lng },
          refId: candidate.ref_id, provider: route.provider || 'vietmap',
          addressResolution: { strategy: 'FIRST_MATCHING_RESULT', selectedRank: index + 1 }
        };
      }
    }
    return unavailable(hadCandidate ? 'PLACE_DETAILS_MISMATCH' : 'ADDRESS_NOT_MATCHED');
  } catch (error) { return unavailable(error.code || 'PROVIDER_ERROR'); }
}
function exactAddress(item, address) {
  const units = [2, 1, 0].map(type => (item.boundaries || []).find(unit => unit.type === type))
    .filter(Boolean).map(unit => unit.full_name || unit.name);
  return [item.address, [item.name, ...units].join(', ')]
    .some(value => normalize(value) === normalize(address));
}
module.exports = { resolveEmployeeDistance };
