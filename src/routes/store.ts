import { Router } from "express";
import { createListProductsHandler } from "../controllers/storeController.js";

export const storeRouter = Router();

const listProductsHandler = createListProductsHandler();

storeRouter.get("/products", listProductsHandler);
