import { Router } from "express";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { type MindbodyService } from "../mindbody/service.js";
import { createHostedPayment, type HostedPaymentResponse } from "../services/cayman.js";
import { transactionMetaStore } from "../storage/transactionMetaStore.js";
import { save, type SessionLine } from "../lib/sessions.js";
import { type CaymanConsumerResponse } from "../types/cayman.js";

interface FrontendApiDependencies {
  mindbodyService: MindbodyService;
}

interface UpsertClientBody {
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  mobilePhone?: unknown;
  birthDate?: unknown;
}

interface FindClientBody {
  email?: unknown;
}

interface CreateSessionBody {
  client?: {
    id?: unknown;
    email?: unknown;
    firstName?: unknown;
    lastName?: unknown;
  };
  cart?: Array<{
    sku?: unknown;
    type?: unknown;
    mboId?: unknown;
    qty?: unknown;
    price?: unknown;
    title?: unknown;
  }>;
  successUrl?: unknown;
  cancelUrl?: unknown;
}

const toTrimmed = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parsePositiveNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
};

const extractMindbodyClientId = (response: unknown): number | undefined => {
  const candidateIds: unknown[] = [
    (response as { Clients?: Array<{ Id?: unknown; UniqueId?: unknown }> })?.Clients?.[0]?.Id,
    (response as { Clients?: Array<{ Id?: unknown; UniqueId?: unknown }> })?.Clients?.[0]?.UniqueId,
    (response as { Client?: { Id?: unknown; UniqueId?: unknown } })?.Client?.Id,
    (response as { Client?: { Id?: unknown; UniqueId?: unknown } })?.Client?.UniqueId,
    (response as { Id?: unknown })?.Id,
    (response as { UniqueId?: unknown })?.UniqueId
  ];

  for (const candidate of candidateIds) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }

    if (typeof candidate === "string") {
      const parsed = Number.parseInt(candidate, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
};

const buildAbsoluteUrl = (pathname: string, query?: Record<string, string | number | boolean | undefined>): string => {
  const base = env.publicBaseUrl?.replace(/\/$/, "") ?? env.appBaseUrl?.replace(/\/$/, "") ?? "";
  const url = new URL(pathname.startsWith("/") ? pathname : `/${pathname}`, base || "http://localhost:3000");

  if (query) {
    for (const [key, raw] of Object.entries(query)) {
      if (raw === undefined) {
        continue;
      }

      url.searchParams.set(key, String(raw));
    }
  }

  return url.toString();
};

const centsToDollars = (valueInCents: number): number => Number.parseFloat((valueInCents / 100).toFixed(2));

export const createFrontendApiRouter = ({ mindbodyService }: FrontendApiDependencies): Router => {
  const router = Router();

  router.post("/api/mbo/clients/upsert", async (req, res) => {
    const body = req.body as UpsertClientBody | undefined;
    const email = toTrimmed(body?.email);

    if (!email) {
      res.status(400).json({ error: "email is required" });
      return;
    }

    const firstName = toTrimmed(body?.firstName) ?? "Guest";
    const lastName = toTrimmed(body?.lastName) ?? "Checkout";
    const birthDate = toTrimmed(body?.birthDate);

    try {
      const response = await mindbodyService.ensureClient({
        email,
        firstName,
        lastName,
        birthDate
      });

      const clientId = extractMindbodyClientId(response);

      if (!clientId) {
        res.status(502).json({ error: "Unable to determine Mindbody client ID" });
        return;
      }

      res.json({
        clientId,
        email,
        firstName,
        lastName
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upsert Mindbody client";
      res.status(502).json({ error: message });
    }
  });

  router.post("/api/mbo/clients/find", async (req, res) => {
    const body = req.body as FindClientBody | undefined;
    const email = toTrimmed(body?.email);

    if (!email) {
      res.status(400).json({ error: "email is required" });
      return;
    }

    try {
      const candidates = await mindbodyService.listClients({ searchText: email, limit: 25 });
      const normalizedEmail = email.toLowerCase();
      const match = candidates.find((client) => client.email?.toLowerCase() === normalizedEmail);

      if (!match) {
        res.status(404).json({ error: "Mindbody client not found" });
        return;
      }

      res.json({
        clientId: match.id,
        email: match.email ?? email,
        firstName: match.firstName ?? undefined,
        lastName: match.lastName ?? undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to lookup Mindbody client";
      res.status(502).json({ error: message });
    }
  });

  router.post("/api/cayman/create-session", async (req, res) => {
    const body = req.body as CreateSessionBody | undefined;
    const clientEmail = toTrimmed(body?.client?.email);
    const clientFirstName = toTrimmed(body?.client?.firstName) ?? "Guest";
    const clientLastName = toTrimmed(body?.client?.lastName) ?? "Checkout";
    const rawClientId = body?.client?.id;
    const clientId =
      typeof rawClientId === "number" && Number.isFinite(rawClientId)
        ? String(rawClientId)
        : toTrimmed(rawClientId);

    if (!clientEmail) {
      res.status(400).json({ error: "client.email is required" });
      return;
    }

    const cartItems = Array.isArray(body?.cart) ? body.cart : [];

    if (cartItems.length === 0) {
      res.status(400).json({ error: "cart must include at least one item" });
      return;
    }

    type NormalizedItem = {
      qty: number;
      priceCents: number;
      mboId: number;
      type: string;
      title?: string;
    };

    const normalizedItems = cartItems.reduce<NormalizedItem[]>((acc, item) => {
      const qty = parsePositiveNumber(item.qty) ?? 1;
      const priceCents = parsePositiveNumber(item.price);
      const mboId = item.mboId;
      const type = toTrimmed(item.type) ?? "Service";

      if (!priceCents || typeof mboId !== "number") {
        return acc;
      }

      acc.push({
        qty,
        priceCents,
        mboId,
        type,
        title: toTrimmed(item.title)
      });

      return acc;
    }, []);

    if (normalizedItems.length === 0) {
      res.status(400).json({ error: "cart contains no valid items" });
      return;
    }

    const totalCents = normalizedItems.reduce((acc, item) => acc + item.priceCents * item.qty, 0);

    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      res.status(400).json({ error: "cart total is invalid" });
      return;
    }

    const amount = centsToDollars(totalCents);
    const sessionId = randomUUID();
    const siteKey = String(process.env.API_CONFIG_SITE_KEY ?? process.env.MINDBODY_SITE_ID ?? "default");
    const orderId = `storefront_${Date.now()}_${sessionId}`;
    const notificationUrl = buildAbsoluteUrl("/webhook/cayman", { sessionId, source: "storefront" });
    const successUrl = toTrimmed(body?.successUrl) ?? buildAbsoluteUrl("/thanks");
    const cancelUrl = toTrimmed(body?.cancelUrl) ?? buildAbsoluteUrl("/cancel");

    const requiresInStore = normalizedItems.some((item) => item.type.toLowerCase() === "product");

    try {
      const sessionLines: SessionLine[] = normalizedItems.map((item) => ({
        productId: String(item.mboId),
        name: item.title ?? `${item.type} ${item.mboId}`,
        unitPrice: Number.parseFloat((item.priceCents / 100).toFixed(2)),
        qty: item.qty,
        type: item.type
      }));

      save({
        id: sessionId,
        siteKey,
        customer: {
          email: clientEmail,
          firstName: clientFirstName,
          lastName: clientLastName
        },
        lines: sessionLines,
        total: Number.parseFloat(amount.toFixed(2)),
        status: "created",
        inStore: requiresInStore,
        ...(clientId ? { clientId } : {}),
        cayman: {
          orderId
        }
      });

      const hostedPayment: HostedPaymentResponse<CaymanConsumerResponse> = await createHostedPayment({
        amount,
        orderId,
        sessionId,
        currency: "USD",
        customer: {
          email: clientEmail,
          firstName: clientFirstName,
          lastName: clientLastName
        },
        notificationUrl,
        returnUrl: successUrl,
        cancelUrl,
        siteKey: process.env.API_CONFIG_SITE_KEY ?? siteKey
      });

      if (!hostedPayment.ok || !hostedPayment.redirectUrl) {
        res.status(502).json({
          error: "Failed to create Cayman checkout session",
          details: hostedPayment.raw
        });
        return;
      }

      const transactionId = toTrimmed((hostedPayment.raw as CaymanConsumerResponse)?.["transaction-id"]);

      if (transactionId) {
        transactionMetaStore[transactionId] = {
          email: clientEmail,
          firstName: clientFirstName,
          lastName: clientLastName,
          mindbodyClientId: clientId,
          mindbodyServiceId: String(normalizedItems[0]?.mboId ?? ""),
          mindbodyServiceDescription: normalizedItems[0]?.title
        };
      }

      res.json({ redirectUrl: hostedPayment.redirectUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create Cayman session";
      res.status(502).json({ error: message });
    }
  });

  return router;
};
