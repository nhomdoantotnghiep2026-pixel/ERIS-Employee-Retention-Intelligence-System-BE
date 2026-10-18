const crypto = require('node:crypto');
const { env } = require('../../config/env');

function generateOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

function hashOtp(otp) {
  return crypto.createHmac('sha256', env.auth.jwtSecret).update(otp).digest('hex');
}

function isOtpValid(otp, expectedHash) {
  const actualHash = Buffer.from(hashOtp(otp), 'hex');
  const expectedHashBuffer = Buffer.from(expectedHash, 'hex');

  return actualHash.length === expectedHashBuffer.length
    && crypto.timingSafeEqual(actualHash, expectedHashBuffer);
}

module.exports = { generateOtp, hashOtp, isOtpValid };
