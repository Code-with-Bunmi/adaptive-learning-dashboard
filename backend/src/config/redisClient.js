import { createClient } from 'redis';
import dotenv from 'dotenv';
dotenv.config();

export const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

redisClient.on('error', (err) => console.error('Redis client error:', err.message));

let connected = false;

/** Call once at server startup. Safe to call multiple times. */
export async function connectRedis() {
  if (connected) return redisClient;
  await redisClient.connect();
  connected = true;
  console.log('✔ Connected to Redis');
  return redisClient;
}

/** JSON get/set/del helpers used by the AI-feedback cache and hot dashboard queries. */
export const cache = {
  async get(key) {
    const raw = await redisClient.get(key);
    return raw ? JSON.parse(raw) : null;
  },
  async set(key, value, ttlSeconds) {
    const raw = JSON.stringify(value);
    if (ttlSeconds) {
      await redisClient.set(key, raw, { EX: ttlSeconds });
    } else {
      await redisClient.set(key, raw);
    }
  },
  async del(key) {
    await redisClient.del(key);
  },
  async delByPrefix(prefix) {
    // Used to invalidate e.g. all cached teacher/admin overview keys for a course after a sync.
    for await (const key of redisClient.scanIterator({ MATCH: `${prefix}*` })) {
      await redisClient.del(key);
    }
  },
};

export default redisClient;
