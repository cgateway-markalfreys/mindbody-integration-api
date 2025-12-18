import express, { Router } from "express";
import { createLegacyCaymanWebhookHandler } from "../controllers/legacyCaymanWebhookController.js";

export const caymanWebhookRouter = Router();

const legacyCaymanWebhookHandler = createLegacyCaymanWebhookHandler();

caymanWebhookRouter.post("/cayman", express.raw({ type: "*/*" }), legacyCaymanWebhookHandler);
