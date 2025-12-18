import express from "express";
import { body } from "express-validator";
import { requireAdminSecret, getAdminConfig, saveAdminConfig } from "../controllers/adminController.js";
import { validate } from "../utils/validate.js";

export const adminRouter = express.Router();

adminRouter.use(express.json({ limit: "1mb" }));
adminRouter.use(express.urlencoded({ extended: false }));
adminRouter.use(requireAdminSecret);

adminRouter.get("/config", getAdminConfig);

adminRouter.post(
  "/config",
  validate([
    body("secret").isString().trim().notEmpty(),
    body("writeSecret").optional({ checkFalsy: true }).isString().trim(),
    body("siteKey").isString().trim().isLength({ min: 1, max: 100 }),
    body("caymanApiKey").isString().trim().isLength({ min: 1 }),
    body("caymanApiUsername").isString().trim().isLength({ min: 1, max: 255 }),
    body("caymanApiPassword").isString().trim().isLength({ min: 1 }),
    body("mindbodyApiKey").isString().trim().isLength({ min: 1 }),
    body("mindbodySourceName").isString().trim().isLength({ min: 1 }),
    body("mindbodySourcePassword").isString().trim().isLength({ min: 1 }),
    body("mindbodySiteId").isString().trim().isLength({ min: 1, max: 100 })
  ]),
  saveAdminConfig
);
