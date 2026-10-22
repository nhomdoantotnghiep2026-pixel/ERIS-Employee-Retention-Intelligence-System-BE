const { distanceConfig } = require('../../config/distance');

function attendanceConfig() {
  const { company } = distanceConfig();
  return { attendance: {
    latitude: company.latitude, longitude: company.longitude,
    radiusMeters: 100, maxAccuracyMeters: 100
  } };
}
module.exports = { attendanceConfig };
