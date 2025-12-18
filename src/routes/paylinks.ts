import { Router } from "express";
import { createPaylinkHandler } from "../controllers/paylinksController.js";

export const paylinksRouter = Router();

const paylinkHandler = createPaylinkHandler();

paylinksRouter.post("/", paylinkHandler);
