import Redis from "ioredis";

// Cache the client on globalThis so Next.js's dev-mode hot reload doesn't
// open a new Redis connection on every file save. In production this
// simply creates one client per process, same as usual.
const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    const url = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    globalForRedis.redis = new Redis(url);
  }
  return globalForRedis.redis;
}