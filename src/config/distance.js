// Keys are optional at startup; missing keys produce an explicit unavailable result.
function number(name, fallback, min, max) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(name + ' is invalid.');
  return value;
}
function distanceConfig() {
  return {
    apiKey: process.env.TOMTOM_API_KEY,
    baseUrl: process.env.TOMTOM_BASE_URL || 'https://api.tomtom.com',
    geocodingApiKey: process.env.VIETMAP_API_KEY,
    geocodingBaseUrl: process.env.VIETMAP_BASE_URL || 'https://maps.vietmap.vn',
    timeoutMs: number('ROUTING_TIMEOUT_MS', 10000, 1000, 30000),
    company: {
      latitude: number('COMPANY_LATITUDE', 10.841158444047021, -90, 90),
      longitude: number('COMPANY_LONGITUDE', 106.81020893790844, -180, 180),
      label: process.env.COMPANY_LOCATION_LABEL || 'FPT University HCMC'
    }
  };
}
module.exports = { distanceConfig };
