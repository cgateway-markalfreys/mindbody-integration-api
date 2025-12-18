import { RequestHandler } from "express";
import { AxiosError } from "axios";
import { MindbodyService } from "../mindbody/service.js";
import { CaymanService } from "../cayman/service.js";
import { CaymanWebhookNotification } from "../types/cayman.js";
import { NonJsonResponseError } from "../mindbody/client.js";
import { transactionMetaStore } from "../storage/transactionMetaStore.js";

const parseAmount = (amount: number | string | undefined): number | undefined => {
  if (typeof amount === "number") {
    return Number.isFinite(amount) ? amount : undefined;
  }

  if (typeof amount === "string") {
    const parsed = Number.parseFloat(amount);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const parseNumericId = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const extractMindbodyClientId = (response: unknown): number | undefined => {
  const candidateIds: Array<unknown> = [
    (response as { Clients?: Array<{ Id?: unknown; UniqueId?: unknown }> })?.Clients?.[0]?.Id,
    (response as { Clients?: Array<{ Id?: unknown; UniqueId?: unknown }> })?.Clients?.[0]?.UniqueId,
    (response as { Client?: { Id?: unknown; UniqueId?: unknown } })?.Client?.Id,
    (response as { Client?: { Id?: unknown; UniqueId?: unknown } })?.Client?.UniqueId,
    (response as { Id?: unknown })?.Id,
    (response as { UniqueId?: unknown })?.UniqueId
  ];

  for (const candidate of candidateIds) {
    const numericId = parseNumericId(candidate);
    if (numericId !== undefined) {
      return numericId;
    }
  }

  return undefined;
};

const normalizeKey = (key: string): string => key.replace(/[^a-z0-9]/gi, "").toLowerCase();

const pickNormalizedString = (source: Record<string, unknown> | undefined, ...keys: Array<string>): string | undefined => {
  if (!source) {
    return undefined;
  }

  const normalized = new Map<string, unknown>();

  for (const [key, value] of Object.entries(source)) {
    normalized.set(normalizeKey(key), value);
  }

  for (const key of keys) {
    const match = normalized.get(normalizeKey(key));
    if (typeof match === "string") {
      const trimmed = match.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return undefined;
};

const pickString = (...candidates: Array<unknown>): string | undefined => {
  for (const value of candidates) {
    if (typeof value === "string") {
      const trimmed = value.trim();

      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return undefined;
};

const DEFAULT_EMAIL = process.env.MINDBODY_DEFAULT_EMAIL ?? "cayman-customer@example.invalid";
const DEFAULT_FIRST_NAME = process.env.MINDBODY_DEFAULT_FIRST_NAME ?? "Cayman";
const DEFAULT_LAST_NAME = process.env.MINDBODY_DEFAULT_LAST_NAME ?? "Customer";

const SITE_ID = process.env.MINDBODY_SITE_ID ?? "-99";
const SELL_TYPE = (process.env.SELL_TYPE ?? "service").toLowerCase() === "pricingoption" ? "pricingOption" : "service";
const SELL_ID = process.env.SELL_ID ?? process.env.MINDBODY_SERVICE_ID ?? "1192";
const STRICT_MATCH = (process.env.STRICT_MATCH ?? "true") !== "false";

const toMoney = (value: number | string | undefined): number => Math.round(Number(value) * 100) / 100;

export const createCaymanWebhookHandler = (
  mindbodyService: MindbodyService,
  caymanService: CaymanService
): RequestHandler => async (req, res) => {
  const payload = req.body as CaymanWebhookNotification;
  const billing = (payload.billing ?? {}) as Record<string, unknown>;
  const transactionId =
    typeof payload["transaction-id"] === "string"
      ? payload["transaction-id"]
      : typeof (payload as Record<string, unknown>).transactionId === "string"
        ? (payload as Record<string, string>).transactionId
        : undefined;
  const meta = transactionMetaStore[transactionId ?? ""] ?? {};
  const metaServiceId =
    typeof meta.mindbodyServiceId === "string" && meta.mindbodyServiceId.trim().length > 0
      ? meta.mindbodyServiceId.trim()
      : undefined;
  const metaServiceDescription =
    typeof meta.mindbodyServiceDescription === "string" && meta.mindbodyServiceDescription.trim().length > 0
      ? meta.mindbodyServiceDescription.trim()
      : undefined;
  const cartItemDescription = metaServiceDescription ?? "Cayman Gateway payment";

  console.log("Received Cayman webhook payload", {
    transactionId: payload["transaction-id"],
    result: payload.result,
    resultCode: payload["result-code"],
    amount: payload.amount,
    billing
  });

  const email = pickString(
    billing.email,
    pickNormalizedString(payload as Record<string, unknown>, "email"),
    pickNormalizedString(billing, "email"),
    DEFAULT_EMAIL
  );
  const firstName = pickString(
    billing["first-name"],
    billing.firstName,
    pickNormalizedString(payload as Record<string, unknown>, "firstName", "first-name"),
    pickNormalizedString(billing, "firstName", "first-name"),
    DEFAULT_FIRST_NAME
  );
  const lastName = pickString(
    billing["last-name"],
    billing.lastName,
    pickNormalizedString(payload as Record<string, unknown>, "lastName", "last-name"),
    pickNormalizedString(billing, "lastName", "last-name"),
    DEFAULT_LAST_NAME
  );
  const amountValue = parseAmount(payload.amount ?? pickNormalizedString(billing, "amount"));
  const resultCode = typeof payload["result-code"] === "string" ? payload["result-code"] : undefined;
  const result = typeof payload.result === "string" ? payload.result : undefined;

  if (result !== "1" || resultCode !== "00") {
    console.warn("Cayman webhook indicates non-success result", { result, resultCode, transactionId: payload["transaction-id"] });
    res.status(200).json({ ok: false, message: "Cayman result does not indicate success." });
    return;
  }

  if (!email || !firstName || !lastName || !amountValue) {
    res.status(400).json({ error: "Missing or invalid payload fields." });
    return;
  }

  const caymanAmount = toMoney(amountValue);

  try {
    await mindbodyService.ensureUserToken();

    const siteStatus = await mindbodyService.getSiteStatus();
    console.log("Mindbody site lookup succeeded", { hasData: Boolean(siteStatus) });

    const clientResponse = await mindbodyService.ensureClient({
      email,
      firstName,
      lastName,
      birthDate: meta.birthDate ?? "1990-01-01"
    });
    console.log("Mindbody client response", clientResponse, { email, firstName, lastName });

    const clientId = extractMindbodyClientId(clientResponse);
    if (!clientId) {
      throw new Error("Unable to determine Mindbody client ID from response.");
    }

    const sellType = SELL_TYPE;
    const sellId = metaServiceId ?? SELL_ID;

    const mindbodyPrice =
      sellType === "pricingOption"
        ? await mindbodyService.getPricingOptionPrice(sellId)
        : await mindbodyService.getServicePrice(sellId);

    if (mindbodyPrice === undefined) {
      res.status(400).json({ error: `Could not find ${sellType} ${sellId} price in Mindbody` });
      return;
    }

    const expectedPrice = toMoney(mindbodyPrice);

    if (STRICT_MATCH && caymanAmount !== expectedPrice) {
      const msg =
        `Cayman amount (${caymanAmount}) does not match Mindbody ${sellType} price (${expectedPrice}). Aborting before checkout.`;
      console.error(msg, { transactionId, clientId, sellType, sellId });
      res.status(400).json({
        error: msg,
        details: {
          transactionId,
          clientId,
          sellType,
          sellId,
          expectedAmount: expectedPrice,
          receivedAmount: caymanAmount
        }
      });
      return;
    }

    await mindbodyService.clearClientCart(clientId);

    const saleResponse = await mindbodyService.addCartItem({
      clientId,
      sellType,
      sellId,
      amount: STRICT_MATCH ? expectedPrice : caymanAmount,
      description: cartItemDescription,
      externalId: transactionId ?? undefined
    });

    console.log("Mindbody checkout success", {
      transactionId,
      clientId,
      sellType,
      sellId,
      caymanAmount,
      mindbodyAmount: expectedPrice
    });

    res.json({ ok: true, checkout: saleResponse });
  } catch (error) {
    if (error instanceof NonJsonResponseError) {
      const details = error.details;
      console.error("Mindbody non-JSON response", {
        message: error.message,
        status: details.status,
        contentType: details.contentType,
        snippet: details.snippet,
        xml: details.xml,
        request: details.request
      });
      res.status(502).json({
        error: "Mindbody API returned non-JSON response.",
        details: {
          status: details.status ?? null,
          contentType: details.contentType ?? null,
          snippet: details.snippet ?? null,
          request: details.request ?? null,
          message: details.xml?.message ?? null,
          errorCode: details.xml?.errorCode ?? null
        }
      });
      return;
    }

    const axiosError = error as AxiosError;
    const errorMessage = axiosError.response?.data ?? axiosError.message;
    let requestDataSnippet: string | undefined;

    try {
      if (typeof axiosError.config?.data === "string") {
        requestDataSnippet = axiosError.config.data.slice(0, 200);
      } else if (axiosError.config?.data) {
        requestDataSnippet = JSON.stringify(axiosError.config.data).slice(0, 200);
      }
    } catch (_err) {
      requestDataSnippet = "[unserializable request data]";
    }

    console.error("Error handling Cayman webhook", {
      message: axiosError.message,
      status: axiosError.response?.status,
      data: axiosError.response?.data ?? errorMessage,
      request: {
        method: axiosError.config?.method,
        url: axiosError.config?.url,
        baseURL: axiosError.config?.baseURL,
        params: axiosError.config?.params,
        dataSnippet: requestDataSnippet
      }
    });
    res
      .status(500)
      .json({ error: typeof errorMessage === "string" ? errorMessage.slice(0, 500) : "Mindbody API error" });
  }
};
