import { type RequestHandler } from "express";
import { hmacVerify } from "../lib/crypto.js";
import { env } from "../lib/env.js";
import { once } from "../utils/idempotency.js";
import { checkoutShoppingCart, issueStaffUserToken, upsertClient } from "../services/mindbody.js";

interface CaymanWebhookEvent {
  id?: string;
  status?: string;
  amount?: number | string;
  metadata?: Record<string, unknown>;
}

const parseClientId = (value: unknown): string | number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
};

const parseAmount = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
};

export const createLegacyCaymanWebhookHandler = (): RequestHandler => async (req, res) => {
  try {
    const rawBody = req.body as Buffer;

    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ error: "Missing raw request body" });
      return;
    }

    const signature = req.get("cayman-signature") ?? req.get("Cayman-Signature");

    if (!hmacVerify(rawBody, signature, env.CAYMAN_WEBHOOK_SECRET)) {
      res.status(400).json({ error: "Invalid Cayman webhook signature" });
      return;
    }

    let event: CaymanWebhookEvent;

    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch (_parseError) {
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
    const itemId = metadata.itemId;
    const itemType = metadata.itemType;

    if (!itemId || !itemType) {
      res.status(400).json({ error: "Webhook metadata missing itemId or itemType" });
      return;
    }

    const rawAmount = parseAmount(event.amount);

    if (rawAmount === undefined) {
      res.status(400).json({ error: "Webhook amount missing or invalid" });
      return;
    }

    const accessToken = await issueStaffUserToken();

    let clientId: string | number;
    if (typeof metadata.clientId === "string" || typeof metadata.clientId === "number") {
      clientId = metadata.clientId;
    } else {
      const email = typeof metadata.email === "string" ? metadata.email : undefined;
      if (!email) {
        res.status(400).json({ error: "Webhook metadata missing clientId and email" });
        return;
      }
      const client = await upsertClient(accessToken, email);
      clientId = client.Id;
    }

    const sale = await checkoutShoppingCart(accessToken, {
      clientId: parseClientId(clientId) ?? String(clientId),
      itemId: String(itemId),
      itemType: String(itemType),
      amountPaid: rawAmount / 100,
      notes: `Cayman ${event.id}`
    });

    res.json({ ok: true, sale });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    res.status(400).json({ error: message });
  }
};