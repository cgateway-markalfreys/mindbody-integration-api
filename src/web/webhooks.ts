import express, { Router } from "express";
import { hmacVerify } from "../lib/crypto.js";
import { once } from "../lib/idempotency.js";
import { env, loadTenants } from "../lib/env.js";
import { checkoutShoppingCart, issueUserToken, upsertClient } from "../integrations/mindbody.js";

interface CaymanEvent {
  id?: string;
  status?: string;
  amount?: number;
  metadata?: Record<string, unknown>;
}

export const webhooksRouter = Router();

webhooksRouter.post("/webhooks/cayman", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ error: "Missing raw request body" });
      return;
    }

    const signature = req.get("cayman-signature") ?? req.get("Cayman-Signature");

    if (!hmacVerify(rawBody, signature, env.CAYMAN_WEBHOOK_SECRET)) {
      res.status(400).json({ error: "bad signature" });
      return;
    }

    let event: CaymanEvent;

    try {
      event = JSON.parse(rawBody.toString("utf8")) as CaymanEvent;
    } catch (error) {
      res.status(400).json({ error: "Invalid JSON webhook payload" });
      return;
    }

    if (!event.id) {
      res.status(400).json({ error: "Webhook event missing id" });
      return;
    }

    if (!once(`cg:${event.id}`)) {
      res.json({ ok: true, deduped: true });
      return;
    }

    if (event.status !== "succeeded") {
      res.json({ ok: true, ignored: true });
      return;
    }

    const metadata = (event.metadata ?? {}) as Record<string, unknown>;
    const siteId = metadata.siteId ?? metadata.siteid;

    if (!siteId) {
      res.status(400).json({ error: "Webhook metadata missing siteId" });
      return;
    }

    const itemId = metadata.itemId ?? metadata.itemid;

    if (!itemId) {
      res.status(400).json({ error: "Webhook metadata missing itemId" });
      return;
    }

    const rawAmount = typeof event.amount === "number" ? event.amount : Number(event.amount ?? 0);
    if (!Number.isFinite(rawAmount)) {
      res.status(400).json({ error: "Webhook amount missing or invalid" });
      return;
    }

    const tenant = loadTenants().get(siteId as string);
    const accessToken = await issueUserToken(tenant);

    const rawClientId = metadata.clientId ?? metadata.clientid;
    const clientId =
      typeof rawClientId === "string" && rawClientId.trim().length > 0
        ? rawClientId.trim()
        : typeof rawClientId === "number" && Number.isFinite(rawClientId)
          ? rawClientId
          : undefined;

    let resolvedClientId: string | number;

    if (clientId !== undefined) {
      resolvedClientId = clientId;
    } else {
      const email = typeof metadata.email === "string" ? metadata.email : undefined;
      if (!email) {
        res.status(400).json({ error: "Webhook metadata missing clientId and email" });
        return;
      }
      const client = await upsertClient(tenant, accessToken, { email });
      resolvedClientId = client.Id ?? client.UniqueId ?? "";
    }

    const sale = await checkoutShoppingCart(tenant, accessToken, {
      clientId: resolvedClientId,
      itemId: itemId as string,
      itemType: (metadata.itemType as string) ?? "Service",
      amountPaid: rawAmount / 100,
      notes: `Cayman ${event.id}`
    });

    res.json({ ok: true, sale });
  } catch (error) {
    const message = error instanceof Error ? error.message : "webhook error";
    res.status(400).json({ error: message });
  }
});
