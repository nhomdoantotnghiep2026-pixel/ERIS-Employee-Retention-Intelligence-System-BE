const Redis = require('ioredis');
const { env } = require('./env');

const redisClient = new Redis(env.redis.url, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null
});

redisClient.on('error', (error) => {
  console.error(`Redis connection error: ${error.message}`);
});

async function ensureRedisConnection() {
  if (redisClient.status === 'wait') {
    await redisClient.connect();
  }

  return redisClient;
}

module.exports = { redisClient, ensureRedisConnection };
