import { type RequestHandler } from "express";
import { env } from "../config/env.js";
import { signCheckoutToken } from "../utils/signing.js";

interface PaylinkRequestBody {
  clientId?: string | number;
  email?: string;
  itemId?: string | number;
  itemType?: string;
  price?: number;
  classId?: string | number;
}

const EXPIRES_IN_SECONDS = 3600;

const normalizeOptionalString = (value: string | number | undefined): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
};

export const createPaylinkHandler = (): RequestHandler => (req, res) => {
  const { clientId, email, itemId, itemType = "Service", price, classId } = (req.body ?? {}) as PaylinkRequestBody;

  if (!itemId) {
    res.status(400).json({ error: "itemId is required" });
    return;
  }

  if (!clientId && !email) {
    res.status(400).json({ error: "clientId or email is required" });
    return;
  }

  const token = signCheckoutToken(
    {
      clientId: normalizeOptionalString(clientId),
      email: normalizeOptionalString(email),
      itemId: String(itemId),
      itemType: String(itemType),
      price: typeof price === "number" && Number.isFinite(price) ? price : undefined,
      classId: normalizeOptionalString(classId)
    },
    EXPIRES_IN_SECONDS
  );

  const url = `${env.publicBaseUrl.replace(/\/$/, "")}/checkout?token=${encodeURIComponent(token)}`;

  res.json({
    url,
    expiresInSec: EXPIRES_IN_SECONDS
  });
};

export const PAYLINK_EXPIRATION_SECONDS = EXPIRES_IN_SECONDS;