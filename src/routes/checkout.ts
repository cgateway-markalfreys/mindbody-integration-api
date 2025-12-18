import { Router } from "express";
import {
  checkoutReturnValidators,
  checkoutValidators,
  createCheckoutReturnHandler,
  createCheckoutSessionHandler
} from "../controllers/checkoutController.js";
import { validate } from "../utils/validate.js";

export const checkoutRouter = Router();

const checkoutSessionHandler = createCheckoutSessionHandler();
const checkoutReturnHandler = createCheckoutReturnHandler();

checkoutRouter.post("/sessions", validate(checkoutValidators), checkoutSessionHandler);

checkoutRouter.get("/return", validate(checkoutReturnValidators), checkoutReturnHandler);
