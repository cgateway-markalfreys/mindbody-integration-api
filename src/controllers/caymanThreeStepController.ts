import { RequestHandler } from "express";
import { CaymanService } from "../cayman/service.js";
import {
  CaymanConsumerResponse,
  CaymanTransactionDetailsResponse,
  CaymanThreeStepOperation,
  CaymanSaleRequest
} from "../types/cayman.js";
import { transactionMetaStore } from "../storage/transactionMetaStore.js";

interface ThreeStepRequestBody {
  operation?: CaymanThreeStepOperation;
  payload?: Record<string, unknown>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toResponse = (result: CaymanConsumerResponse | CaymanTransactionDetailsResponse) => ({
  ok: true,
  data: result
});

export const createCaymanThreeStepHandler = (service: CaymanService): RequestHandler => async (req, res) => {
  const { operation, payload } = req.body as ThreeStepRequestBody;

  if (!operation) {
    res.status(400).json({ error: "operation is required" });
    return;
  }

  if (!payload || !isObject(payload)) {
    res.status(400).json({ error: "payload must be an object" });
    return;
  }

  const { mindbodyServiceId, mindbodyServiceDescription, mindbodyClientId, ...gatewayPayload } = payload;

  try {
    let result: CaymanConsumerResponse | CaymanTransactionDetailsResponse;

    switch (operation) {
      case "add-customer":
        result = await service.createAddCustomerSession(gatewayPayload as never);
        break;
      case "sale":
        result = await service.createSaleSession(gatewayPayload as never);

        if (result["transaction-id"]) {
          const salePayload = gatewayPayload as CaymanSaleRequest;
          const transactionId = String(result["transaction-id"]);
          const metaServiceId =
            typeof mindbodyServiceId === "string" && mindbodyServiceId.trim().length > 0
              ? mindbodyServiceId.trim()
              : undefined;
          const metaServiceDescription =
            typeof mindbodyServiceDescription === "string" && mindbodyServiceDescription.trim().length > 0
              ? mindbodyServiceDescription.trim()
              : undefined;
          const metaClientId =
            typeof mindbodyClientId === "string" && mindbodyClientId.trim().length > 0
              ? mindbodyClientId.trim()
              : undefined;

          transactionMetaStore[transactionId] = {
            ...transactionMetaStore[transactionId],
            birthDate: salePayload.birthDate,
            email: salePayload.email,
            firstName: salePayload.firstName,
            lastName: salePayload.lastName,
            ...(metaClientId ? { mindbodyClientId: metaClientId } : {}),
            ...(metaServiceId ? { mindbodyServiceId: metaServiceId } : {}),
            ...(metaServiceDescription ? { mindbodyServiceDescription: metaServiceDescription } : {})
          };
        }
        break;
      case "sale-from-vault":
        result = await service.chargeSavedCard(gatewayPayload as never);
        break;
      case "subscribe":
        result = await service.createSubscriptionSession(gatewayPayload as never);
        break;
      case "authonly":
        result = await service.authorizePayment(gatewayPayload as never);
        break;
      case "refund":
        result = await service.refundTransaction(gatewayPayload as never);
        break;
      case "reverse":
        result = await service.reverseTransaction(gatewayPayload as never);
        break;
      case "capture":
        result = await service.captureAuthorization(gatewayPayload as never);
        break;
      case "void":
        result = await service.voidAuthorization(gatewayPayload as never);
        break;
      case "cancel-subscription":
        result = await service.cancelSubscription(gatewayPayload as never);
        break;
      case "recurauth":
        result = await service.triggerRecurringCharge(gatewayPayload as never);
        break;
      case "transaction-info":
        result = await service.getTransactionDetails(gatewayPayload as never);
        break;
      default:
        res.status(400).json({ error: `Unsupported operation: ${operation}` });
        return;
    }

    res.json(toResponse(result));
  } catch (error) {
    console.error("Cayman three-step operation failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(502).json({ error: message });
  }
};
