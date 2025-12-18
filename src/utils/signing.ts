import crypto from "crypto";
import { env } from "../config/env.js";

const resolveSecret = (): string => {
  const value = env.linkSigningSecret ?? process.env.HMAC_SECRET;

  if (!value) {
    throw new Error("LINK_SIGNING_SECRET (or HMAC_SECRET) is required for signing operations.");
  }

  return value;
};

const base64UrlEncode = (buffer: Buffer): string =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const base64UrlDecode = (value: string): Buffer => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padding), "base64");
};

/**
 * Produces a deterministic string for signing.
 */
export const canonical = (input: Record<string, unknown>): string => {
  const sorted = Object.keys(input)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = input[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
};

export const sign = (input: Record<string, unknown>): string => {
  const hmac = crypto.createHmac("sha256", resolveSecret());
  hmac.update(canonical(input));
  return hmac.digest("hex");
};

export const verify = (input: Record<string, unknown>, signature: string): boolean => {
  try {
    const expected = sign(input);
    const left = Buffer.from(expected, "utf8");
    const right = Buffer.from(signature, "utf8");

    if (left.length !== right.length) {
      return false;
    }

    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
};

export const makeIdemKey = (input: Record<string, unknown>): string => sign(input);

export interface CheckoutTokenClaims {
  clientId?: string;
  email?: string;
  itemId: string;
  itemType: string;
  price?: number;
  classId?: string;
  exp: number;
}

type CheckoutTokenPayload = Omit<CheckoutTokenClaims, "exp">;

export const signCheckoutToken = (payload: CheckoutTokenPayload, expiresInSeconds: number): string => {
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("expiresInSeconds must be a positive number");
  }

  const exp = Math.floor(Date.now() / 1000) + Math.floor(expiresInSeconds);
  const claims: CheckoutTokenClaims = {
    clientId: typeof payload.clientId === "string" && payload.clientId.trim().length > 0 ? payload.clientId : undefined,
    email: typeof payload.email === "string" && payload.email.trim().length > 0 ? payload.email : undefined,
    itemId: String(payload.itemId),
    itemType: String(payload.itemType),
    price:
      typeof payload.price === "number" && Number.isFinite(payload.price) ? Math.round(payload.price * 100) / 100 : undefined,
    classId: typeof payload.classId === "string" && payload.classId.trim().length > 0 ? payload.classId : undefined,
    exp
  };

  const secret = resolveSecret();
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(claims), "utf8"));
  const signature = base64UrlEncode(crypto.createHmac("sha256", secret).update(encodedPayload).digest());

  return `${encodedPayload}.${signature}`;
};

export const verifyCheckoutToken = (token: string): CheckoutTokenClaims => {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    throw new Error("Invalid checkout token format");
  }

  const secret = resolveSecret();
  const expectedSignature = base64UrlEncode(crypto.createHmac("sha256", secret).update(encodedPayload).digest());
  const provided = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new Error("Invalid checkout token signature");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    throw new Error("Invalid checkout token payload");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid checkout token payload");
  }

  const claims = parsed as Record<string, unknown>;
  const exp = typeof claims.exp === "number" ? claims.exp : Number.NaN;

  if (!Number.isFinite(exp)) {
    throw new Error("Checkout token missing expiration");
  }

  const now = Math.floor(Date.now() / 1000);
  if (exp <= now) {
    throw new Error("Checkout token expired");
  }

  return {
    clientId: typeof claims.clientId === "string" && claims.clientId.trim().length > 0 ? claims.clientId : undefined,
    email: typeof claims.email === "string" && claims.email.trim().length > 0 ? claims.email : undefined,
    itemId: String(claims.itemId ?? ""),
    itemType: String(claims.itemType ?? ""),
    price: typeof claims.price === "number" && Number.isFinite(claims.price) ? claims.price : undefined,
    classId: typeof claims.classId === "string" && claims.classId.trim().length > 0 ? claims.classId : undefined,
    exp
  };
};
