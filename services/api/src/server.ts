import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerRoutes } from "./routes";

export const createServer = () => {
  const app = Fastify({ logger: true });
  app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  });
  app.register(registerRoutes);
  return app;
};
