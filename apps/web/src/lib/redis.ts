import Redis from "ioredis";

// Single shared connection, reused across API routes in the same runtime
// instance. Matches the Redis Streams contract in DESIGN.md §7.
let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  }
  return client;
}
