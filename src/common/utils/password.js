const bcrypt = require('bcrypt');

async function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, 12);
}

module.exports = { verifyPassword, hashPassword };
