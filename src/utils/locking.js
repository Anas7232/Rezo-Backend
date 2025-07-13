import redis from "../config/redis.js";

export const acquireLock = async (key, ttl = 5000) => {
  const lock = await redis.set(key, "LOCKED", "PX", ttl, "NX");
  if (!lock) throw new Error("LockAcquisitionError");
  return { key, ttl };
};

export const releaseLock = async (lock) => {
  await redis.del(lock.key);
};
