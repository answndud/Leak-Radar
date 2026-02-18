import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerRoutes } from "./routes";
import { loadConfig } from "./config";

export const createServer = () => {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  app.register(cors, {
    origin: (origin, callback) => {
      if (config.corsOrigins.length === 0 || !origin) {
        callback(null, true);
        return;
      }
      callback(null, config.corsOrigins.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  });
  app.register(registerRoutes);
  return app;
};
