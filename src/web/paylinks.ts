import { Router } from "express";
import { signToken } from "../lib/crypto.js";
import { env, loadTenants } from "../lib/env.js";

export const paylinksRouter = Router();

paylinksRouter.use((_, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

paylinksRouter.post("/api/paylinks", (req, res) => {
  const { siteId, clientId, email, itemId, itemType = "Service", price, classId } = (req.body ?? {}) as Record<
    string,
    unknown
  >;

  if (!siteId || !itemId || (!clientId && !email)) {
    res.status(400).json({ error: "siteId, itemId and clientId|email required" });
    return;
  }

  loadTenants().get(siteId as string);

  const priceValue = typeof price === "number" && Number.isFinite(price) ? price : undefined;
  const token = signToken(
    {
      siteId: String(siteId),
      clientId: clientId ? String(clientId) : undefined,
      email: email ? String(email) : undefined,
      itemId: String(itemId),
      itemType: String(itemType),
      price: priceValue,
      classId: classId ? String(classId) : undefined
    },
    3600
  );

  const baseUrl = env.APP_BASE_URL.replace(/\/$/, "");
  res.json({
    url: `${baseUrl}/checkout?token=${encodeURIComponent(token)}`,
    expiresInSec: 3600
  });
});
