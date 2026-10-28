const { AppError } = require('../../common/errors/app-error');
const COMPANY_LOCATION_KEY = 'eris:attendance:company-location:v1';

function validateCompanyLocation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['address', 'latitude', 'longitude'].includes(key))) {
    throw new AppError(400, 'Chỉ nhận address, latitude, longitude.');
  }
  if (typeof body.address !== 'string' || !body.address.trim() || body.address.trim().length > 500
    || /[\u0000-\u001f\u007f]/.test(body.address)) {
    throw new AppError(400, 'Địa chỉ bắt buộc, tối đa 500 ký tự và không có ký tự điều khiển.');
  }
  for (const [key, min, max] of [['latitude', -90, 90], ['longitude', -180, 180]]) {
    if (!Number.isFinite(body[key]) || body[key] < min || body[key] > max) {
      throw new AppError(400, `${key} phải là số trong khoảng ${min} đến ${max}.`);
    }
  }
  return { address: body.address.trim(), latitude: body.latitude, longitude: body.longitude };
}

class CompanyLocationStore {
  constructor({ redisClient, ensureRedisConnection, fallback, key = COMPANY_LOCATION_KEY }) {
    this.redis = redisClient;
    this.connect = ensureRedisConnection;
    this.fallback = fallback;
    this.key = key;
  }
  async get() {
    try {
      await this.connect();
      const raw = await this.redis.get(this.key);
      if (raw === null) return { ...this.fallback, source: 'env', updatedAt: null, updatedBy: null };
      const data = JSON.parse(raw);
      return { ...validateCompanyLocation({ address: data.address, latitude: data.latitude, longitude: data.longitude }),
        source: 'redis', updatedAt: data.updatedAt, updatedBy: data.updatedBy };
    } catch {
      throw new AppError(503, 'Không đọc được cấu hình vị trí công ty. Kiểm tra Redis trước khi chấm công.');
    }
  }
  async set(body, actorId) {
    const input = validateCompanyLocation(body);
    const data = { ...input, updatedAt: new Date().toISOString(), updatedBy: actorId };
    try {
      await this.connect();
      const result = await this.redis.set(this.key, JSON.stringify(data));
      if (result !== 'OK') throw new Error('Redis SET failed');
      return { ...data, source: 'redis' };
    } catch {
      throw new AppError(503, 'Không lưu được vị trí công ty vào Redis.');
    }
  }
}
module.exports = { CompanyLocationStore, validateCompanyLocation, COMPANY_LOCATION_KEY };
