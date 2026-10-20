// Full-address matching is deliberately conservative: never silently choose the first suggestion.
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/gi, 'd').toLowerCase().replace(/\b(?:tp\.?\s*hcm|hcm)\b/g, 'ho chi minh')
  .replace(/\bho chi minh city\b/g, 'ho chi minh')
  .replace(/\b(thanh pho|tp|tinh|quan|huyen|phuong|xa|duong|viet nam|vietnam)\b/g, ' ')
  .replace(/[^a-z0-9/]+/g, ' ').trim().replace(/\s+/g, ' ');

async function resolveEmployeeDistance(address, service) {
  if (!address) return { distanceFromHomeKm: null, status: 'NOT_PROVIDED', reason: null };
  if (!service?.geocodeFull || !service?.placeByRefId || !service?.calculate) {
    return { distanceFromHomeKm: null, status: 'UNAVAILABLE', reason: 'GEOCODING_NOT_CONFIGURED' };
  }
  try {
    const variants = (await service.geocodeFull(address)).flatMap(item => [item, item.data_old].filter(Boolean));
    const matches = [...new Map(variants.filter(item => {
      const boundaries = item.boundaries || [];
      if (!item.ref_id || !/^[0-9]/.test(item.name || '') || !boundaries.some(unit => unit.type === 0)
        || !boundaries.some(unit => unit.type === 2)) return false;
      const units = [2, 1, 0].map(type => boundaries.find(unit => unit.type === type))
        .filter(Boolean).map(unit => unit.full_name || unit.name);
      return normalize([item.name, ...units].join(', ')) === normalize(address);
    }).map(item => [item.ref_id, item])).values()];
    if (matches.length !== 1) return { distanceFromHomeKm: null, status: 'UNAVAILABLE',
      reason: matches.length ? 'AMBIGUOUS_ADDRESS' : 'ADDRESS_NOT_MATCHED' };
    const place = await service.placeByRefId(matches[0].ref_id, 'home');
    if (!place.hs_num || !place.street || !place.ward || !place.city
      || !Number.isFinite(place.lat) || place.lat < -90 || place.lat > 90
      || !Number.isFinite(place.lng) || place.lng < -180 || place.lng > 180
      || normalize([place.hs_num, place.street, place.ward, place.district, place.city].filter(Boolean).join(', ')) !== normalize(address)) {
      return { distanceFromHomeKm: null, status: 'UNAVAILABLE', reason: 'PLACE_DETAILS_MISMATCH' };
    }
    const route = await service.calculate({ home: { latitude: place.lat, longitude: place.lng, label: place.display || address } });
    if (!Number.isFinite(route.distanceFromHomeKm) || route.distanceFromHomeKm < 0 || route.distanceFromHomeKm > 999999.99) {
      return { distanceFromHomeKm: null, status: 'UNAVAILABLE', reason: 'INVALID_ROUTE_DISTANCE' };
    }
    return { distanceFromHomeKm: route.distanceFromHomeKm, status: 'READY', reason: null,
      normalizedAddress: place.display || address, coordinates: { latitude: place.lat, longitude: place.lng } };
  } catch (error) {
    return { distanceFromHomeKm: null, status: 'UNAVAILABLE', reason: error.code || 'PROVIDER_ERROR' };
  }
}

module.exports = { resolveEmployeeDistance };
