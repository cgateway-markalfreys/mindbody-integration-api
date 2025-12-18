import "dotenv/config";
import "./config/loadDbEnv.js";
import express, { Express } from "express";
import cors from "cors";
import morgan from "morgan";
import { registerRoutes, RouteDependencies } from "./routes/index.js";
import { storeRouter } from "./routes/store.js";
import { webhookRouter } from "./routes/webhooks.js";

export const createApp = (deps: RouteDependencies): Express => {
  const app = express();

  app.use(cors());
  app.use(morgan("combined"));
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/store", storeRouter);
  app.use("/webhook", webhookRouter);

  registerRoutes(app, deps);

  console.log("[config] PUBLIC_BASE_URL =", process.env.PUBLIC_BASE_URL || "(missing)");

  return app;
};
