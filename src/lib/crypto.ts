import crypto from "node:crypto";
import { env } from "./env.js";

export interface SignedClaims {
  exp: number;
  [key: string]: unknown;
}

export const signToken = (payload: Record<string, unknown>, ttlSec = 3600): string => {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = Buffer.from(JSON.stringify({ ...payload, exp }), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", env.LINK_SIGNING_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
};

export const verifyToken = (token: string): SignedClaims => {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 2) {
    throw new Error("bad token");
  }

  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", env.LINK_SIGNING_SECRET).update(body).digest("base64url");

  if (sig !== expected) {
    throw new Error("bad token");
  }

  let claims: SignedClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedClaims;
  } catch (error) {
    throw new Error("invalid token body");
  }

  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("expired");
  }

  return claims;
};

export const hmacVerify = (raw: Buffer, header: string | undefined | null, secret: string): boolean => {
  if (!header) {
    return false;
  }

  const expected = crypto.createHmac("sha256", secret).update(raw).digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(header, "hex");
  } catch (error) {
    return false;
  }

  if (expected.length !== provided.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(expected, provided);
  } catch (error) {
    return false;
  }
};
