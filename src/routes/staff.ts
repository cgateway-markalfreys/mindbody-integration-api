import express from "express";
import { type MindbodyService } from "../mindbody/service.js";
import {
  createGetStaffClientsHandler,
  createGetStaffPaySummaryHandler,
  createGetStaffReceiptHandler,
  createStaffPayHandler,
  requireStaffSecret,
  type StaffControllerDependencies
} from "../controllers/staffController.js";

interface StaffRouterDependencies {
  mindbodyService: MindbodyService;
}

export const createStaffRouter = ({ mindbodyService }: StaffRouterDependencies): express.Router => {
  const router = express.Router();

  const getStaffPaySummary = createGetStaffPaySummaryHandler();
  const staffPayHandler = createStaffPayHandler();
  const controllerDependencies: StaffControllerDependencies = { mindbodyService };
  const getStaffClients = createGetStaffClientsHandler(controllerDependencies);
  const getStaffReceipt = createGetStaffReceiptHandler();

  router.get("/pay", requireStaffSecret, getStaffPaySummary);

  router.post(
    "/pay",
    express.json(),
    express.urlencoded({ extended: true }),
    requireStaffSecret,
    staffPayHandler
  );

  router.get("/clients", requireStaffSecret, getStaffClients);
  router.get("/receipt", getStaffReceipt);

  return router;
};

export default createStaffRouter;
