// config/session.js
import session from "express-session";
import redis from "./redis.js";
import { RedisStore } from "connect-redis";
import config from "./env.js";
export const sessionStore = new RedisStore({
  client: redis,
  ttl: 86400,
  prefix: "session:"
});
const sessionConfig = {
  store: sessionStore,
  secret: config.get("sessionSecrate"),
  resave: false,
  saveUninitialized: false,
  name: "connect.sid",
  cookie: {
    // secure: config.get("env") === "production",
    secure: false,
    secureProxy: false,
    httpOnly: true,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  },
};
export const sessionMiddleware = session(sessionConfig);

export default sessionConfig;
