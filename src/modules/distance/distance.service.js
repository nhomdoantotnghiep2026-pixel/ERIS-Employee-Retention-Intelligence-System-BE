const { AppError } = require('../../common/errors/app-error');
class HttpError extends AppError {
  constructor(status, code, message) { super(status, message); this.code = code; }
}

const text = (value, field, maxLength = 300) => {
  if (typeof value !== 'string') throw new HttpError(400, 'VALIDATION_ERROR', `${field} is required`);
  const normalized = value.trim();
  if (normalized.length < 3 || normalized.length > maxLength) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} must contain 3 to ${maxLength} characters`);
  }
  return normalized;
};

const finiteCoordinate = (value, field, minimum, maximum) => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be between ${minimum} and ${maximum}`);
  }
  return value;
};

const haversineKm = (start, end) => {
  const radians = degrees => degrees * Math.PI / 180;
  const deltaLatitude = radians(end.lat - start.lat);
  const deltaLongitude = radians(end.lng - start.lng);
  const arc = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(start.lat)) * Math.cos(radians(end.lat)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
};

const round = (value, places) => Number(value.toFixed(places));

const requestJson = async (fetchImpl, url, options, timeoutMs, service) => {
  let response;
  try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new HttpError(504, 'ROUTING_TIMEOUT', `${service} request timed out`);
    }
    throw new HttpError(502, 'ROUTING_SERVICE_ERROR', `${service} is unavailable`);
  }
  if (response.status === 429 || response.status === 423) {
    throw new HttpError(503, 'ROUTING_RATE_LIMITED', `${service} quota reached`);
  }
  if ([401, 403].includes(response.status)) {
    throw new HttpError(503, 'ROUTING_CONFIGURATION_ERROR', `${service} API key or restrictions are invalid`);
  }
  if (!response.ok) throw new HttpError(502, 'ROUTING_SERVICE_ERROR', `${service} request failed`);
  try { return await response.json(); }
  catch { throw new HttpError(502, 'ROUTING_SERVICE_ERROR', `${service} returned an invalid response`); }
};

function createDistanceService(config = {}, fetchImpl = globalThis.fetch) {
  const vietmapKey = config.geocodingApiKey;
  const vietmapBaseUrl = (config.geocodingBaseUrl || 'https://maps.vietmap.vn').replace(/\/$/, '');
  const routingKey = config.apiKey || vietmapKey;
  const routingBaseUrl = (config.baseUrl || vietmapBaseUrl).replace(/\/$/, '');
  const timeoutMs = config.timeoutMs || 10000;
  const company = config.company;

  const requireVietmap = () => {
    if (!vietmapKey) throw new HttpError(503, 'GEOCODING_NOT_CONFIGURED', 'Vietmap API key is required');
  };

  const placeDetails = async (refId, field) => {
    requireVietmap();
    const placeUrl = new URL(`${vietmapBaseUrl}/api/place/v4`);
    placeUrl.searchParams.set('apikey', vietmapKey);
    placeUrl.searchParams.set('refid', text(refId, `${field}.refId`, 2000));
    const result = await requestJson(fetchImpl, placeUrl, { headers: { Accept: 'application/json' } }, timeoutMs, 'Vietmap');
    if (!Number.isFinite(result?.lat) || !Number.isFinite(result?.lng)) {
      throw new HttpError(422, 'ADDRESS_NOT_FOUND', `${field} could not be located`);
    }
    return result;
  };
  const place = async (refId, field) => {
    const result = await placeDetails(refId, field);
    return { lat: result.lat, lng: result.lng, label: result.display || result.address || result.name || field };
  };

  const search = async (query) => {
    requireVietmap();
    const searchUrl = new URL(`${vietmapBaseUrl}/api/search/v4`);
    searchUrl.searchParams.set('apikey', vietmapKey);
    searchUrl.searchParams.set('text', text(query, 'query'));
    searchUrl.searchParams.set('display_type', '5');
    const matches = await requestJson(fetchImpl, searchUrl, { headers: { Accept: 'application/json' } }, timeoutMs, 'Vietmap');
    if (!Array.isArray(matches)) throw new HttpError(502, 'ROUTING_SERVICE_ERROR', 'Vietmap returned an invalid response');
    return Promise.all(matches.filter(item => item?.ref_id).slice(0, 5).map(async item => {
      const coordinates = await placeDetails(item.ref_id, 'place');
      return {
        refId: item.ref_id,
        name: item.name || '',
        address: item.address || '',
        display: item.display || [item.name, item.address].filter(Boolean).join(', '),
        isCompleteAddress: !!(coordinates.hs_num && coordinates.street && coordinates.city),
        resolvedAddress: coordinates.hs_num && coordinates.street && coordinates.city
          ? [[coordinates.hs_num, coordinates.street].join(' '), coordinates.ward, coordinates.district, coordinates.city].filter(Boolean).join(', ')
          : coordinates.display || item.display || [item.name, item.address].filter(Boolean).join(', '),
        latitude: coordinates.lat,
        longitude: coordinates.lng,
      };
    }));
  };

  const location = async (value, field) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be an object`);
    }
    const keys = Object.keys(value);
    const supported = ['refId', 'latitude', 'longitude', 'label'];
    if (keys.some(key => !supported.includes(key))) {
      throw new HttpError(400, 'VALIDATION_ERROR', `${field} contains unsupported fields`);
    }
    if (value.refId !== undefined) {
      if (keys.some(key => ['latitude', 'longitude', 'label'].includes(key))) {
        throw new HttpError(400, 'VALIDATION_ERROR', `${field} must use either refId or coordinates`);
      }
      return place(value.refId, field);
    }
    const lat = finiteCoordinate(value.latitude, `${field}.latitude`, -90, 90);
    const lng = finiteCoordinate(value.longitude, `${field}.longitude`, -180, 180);
    const label = value.label === undefined ? `${lat},${lng}` : text(value.label, `${field}.label`);
    return { lat, lng, label };
  };

  return {
    search,
    async geocodeFull(query) {
      requireVietmap();
      const url = new URL(`${vietmapBaseUrl}/api/search/v4`);
      url.searchParams.set('apikey', vietmapKey);
      url.searchParams.set('text', text(query, 'query'));
      url.searchParams.set('display_type', '5');
      const matches = await requestJson(fetchImpl, url, { headers: { Accept: 'application/json' } }, timeoutMs, 'Vietmap');
      if (!Array.isArray(matches)) throw new HttpError(502, 'ROUTING_SERVICE_ERROR', 'Vietmap returned an invalid response');
      return matches.filter(item => typeof item?.ref_id === 'string');
    },
    placeByRefId: placeDetails,
    async calculate(body) {
      if (!routingKey) throw new HttpError(503, 'ROUTING_NOT_CONFIGURED', 'Vietmap routing API key is required');
      if (!company || !Number.isFinite(company.latitude) || !Number.isFinite(company.longitude) || Math.abs(company.latitude) > 90 || Math.abs(company.longitude) > 180 || !company.label) {
        throw new HttpError(503, 'COMPANY_LOCATION_NOT_CONFIGURED', 'Company location is required');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Request body must be an object');
      }
      if (Object.keys(body).some(key => key !== 'home')) {
        throw new HttpError(409, 'ADDRESS_CONFIRMATION_REQUIRED',
          'Select a confirmed home with GET /api/distance/places; the company location is fixed by the server');
      }
      const home = await location(body.home, 'home');
      const routeUrl = new URL(routingBaseUrl + '/api/route/v4');
      routeUrl.searchParams.set('apikey', routingKey);
      routeUrl.searchParams.append('point', home.lat + ',' + home.lng);
      routeUrl.searchParams.append('point', company.latitude + ',' + company.longitude);
      routeUrl.searchParams.set('vehicle', 'car');
      routeUrl.searchParams.set('points_encoded', 'true');
      routeUrl.searchParams.set('alternative', 'false');
      const routingDepartureTime = new Date().toISOString();
      routeUrl.searchParams.set('time', routingDepartureTime);
      const data = await requestJson(fetchImpl, routeUrl, { headers: { Accept: 'application/json' } }, timeoutMs, 'Vietmap routing');
      if (data?.code === 'OVER_DAILY_LIMIT') throw new HttpError(503, 'ROUTING_RATE_LIMITED', 'Vietmap routing quota reached');
      if (data?.code === 'ZERO_RESULTS') throw new HttpError(422, 'ROUTE_NOT_FOUND', 'A driving route could not be calculated');
      if (data?.code !== 'OK') throw new HttpError(502, 'ROUTING_SERVICE_ERROR', 'Vietmap routing returned an unsuccessful response');
      const summary = data.paths?.[0];
      if (!Number.isFinite(summary?.distance) || summary.distance < 0 || !Number.isFinite(summary?.time) || summary.time < 0) {
        throw new HttpError(502, 'ROUTING_SERVICE_ERROR', 'Vietmap routing returned invalid distance or duration');
      }
      const straightLineKm = haversineKm(home, { lat: company.latitude, lng: company.longitude });
      const routeKm = summary.distance / 1000;
      return {
        distanceFromHomeKm: round(routeKm, 2),
        straightLineDistanceKm: round(straightLineKm, 2),
        routeToStraightLineRatio: straightLineKm === 0 ? null : round(routeKm / straightLineKm, 2),
        estimatedDurationMinutes: Math.round((summary.time / 60000) * 10) / 10,
        // Route v4 does not return a flag confirming live-traffic coverage.
        trafficAware: null,
        routingDepartureTime,
        travelMode: 'car',
        origin: home.label,
        destination: company.label,
        originCoordinates: { latitude: home.lat, longitude: home.lng },
        destinationCoordinates: { latitude: company.latitude, longitude: company.longitude },
        provider: 'vietmap',
      };
    },
  };
}

module.exports = { createDistanceService };
