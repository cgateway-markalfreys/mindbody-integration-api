import express, { Express } from "express";
import { AxiosError } from "axios";
import { createCaymanWebhookHandler } from "../controllers/caymanWebhookController.js";
import { createCaymanThreeStepHandler } from "../controllers/caymanThreeStepController.js";
import { CaymanService } from "../cayman/service.js";
import { MindbodyService } from "../mindbody/service.js";
import { NonJsonResponseError } from "../mindbody/client.js";
import { createStaffRouter } from "./staff.js";
import { paylinksRouter as legacyPaylinksRouter } from "./paylinks.js";
import { checkoutRouter as legacyCheckoutRouter } from "./checkout.js";
import { caymanWebhookRouter as caymanCheckoutWebhookRouter } from "./webhooks-cayman.js";
import { webhooksRouter } from "../web/webhooks.js";
import { catalogRouter } from "../web/catalog.js";
import { paylinksRouter } from "../web/paylinks.js";
import { checkoutRouter } from "../web/checkout.js";
import { createFrontendApiRouter } from "../web/frontendApi.js";
import { adminRouter } from "./admin.js";

export interface RouteDependencies {
  mindbodyService: MindbodyService;
  caymanService: CaymanService;
}

export const registerRoutes = (app: Express, deps: RouteDependencies): void => {
  app.use(webhooksRouter);
  app.use("/webhooks", caymanCheckoutWebhookRouter);

  app.use(express.json());

  app.use(createFrontendApiRouter(deps));
  app.use(catalogRouter);
  app.use(paylinksRouter);
  app.use(checkoutRouter);
  app.use("/admin", adminRouter);

  app.get("/", (_req, res) => {
    res.send("Cayman Gateway ↔ Mindbody integration is running!");
  });

  app.use("/paylinks", legacyPaylinksRouter);
  app.use("/checkout", legacyCheckoutRouter);
  app.use("/v1/checkout", legacyCheckoutRouter);

  app.get("/health/mindbody", async (_req, res) => {
    try {
      const site = await deps.mindbodyService.getSiteStatus();
      res.json({ ok: true, site });
    } catch (error) {
      if (error instanceof NonJsonResponseError) {
        res.status(503).json({
          ok: false,
          error: "Mindbody API returned non-JSON response.",
          details: {
            status: error.details.status ?? null,
            contentType: error.details.contentType ?? null,
            snippet: error.details.snippet ?? null,
            request: error.details.request ?? null
          }
        });
        return;
      }

      const axiosError = error as AxiosError;
      res
        .status(503)
        .json({ ok: false, error: axiosError.message, status: axiosError.response?.status ?? null });
    }
  });

  app.post("/webhook/cayman", createCaymanWebhookHandler(deps.mindbodyService, deps.caymanService));
  app.post("/cayman/three-step", createCaymanThreeStepHandler(deps.caymanService));
  app.use("/staff", createStaffRouter({ mindbodyService: deps.mindbodyService }));

  app.get("/thanks", (_req, res) => {
    res.send("Thanks! Payment received.");
  });

  app.get("/cancel", (_req, res) => {
    res.send("Payment cancelled.");
  });
};
