import { Router } from "express";
import { verifyToken } from "../lib/crypto.js";
import { env, loadTenants, TenantConfig } from "../lib/env.js";
import { createPayment } from "../integrations/cayman.js";
import { issueUserToken, listServices } from "../integrations/mindbody.js";
import type { MindbodyServiceSummary } from "../integrations/mindbody.js";

interface CheckoutClaims {
  siteId: string;
  itemId: string;
  itemType: string;
  email?: string;
  clientId?: string;
  price?: number;
  classId?: string;
}

export const checkoutRouter = Router();

checkoutRouter.get("/checkout", async (req, res) => {
  try {
    let claims: CheckoutClaims;
    if (req.query.token) {
      const verified = verifyToken(String(req.query.token)) as Record<string, unknown>;
      claims = {
        siteId: String(verified.siteId ?? ""),
        itemId: String(verified.itemId ?? ""),
        itemType: String(verified.itemType ?? "Service"),
        email: typeof verified.email === "string" ? verified.email : undefined,
        clientId: typeof verified.clientId === "string" ? verified.clientId : undefined,
        price: typeof verified.price === "number" ? verified.price : undefined,
        classId: typeof verified.classId === "string" ? verified.classId : undefined
      };
    } else {
      const { siteId, itemId, itemType = "Service", email, clientId, price, classId } = req.query as Record<
        string,
        string
      >;

      if (!siteId || !itemId || (!clientId && !email)) {
        throw new Error("siteId, itemId and clientId|email required");
      }

      claims = {
        siteId: String(siteId),
        itemId: String(itemId),
        itemType: String(itemType || "Service"),
        email: email ? String(email) : undefined,
        clientId: clientId ? String(clientId) : undefined,
        price: typeof price === "string" && price.trim().length > 0 ? Number(price) : undefined,
        classId: classId ? String(classId) : undefined
      };
    }

    const tenants = loadTenants();
    const tenant = tenants.get(claims.siteId);
    const amount = await trustedPrice(tenant, claims.itemId, claims.itemType, claims.price);
    const baseUrl = env.APP_BASE_URL.replace(/\/$/, "");

    const payment = await createPayment({
      amount: Math.round(Number(amount) * 100),
      currency: tenant.currency || "USD",
      description: `Site ${tenant.siteId} · ${claims.itemType} ${claims.itemId}`,
      metadata: {
        siteId: String(tenant.siteId),
        itemId: String(claims.itemId),
        itemType: String(claims.itemType),
        clientId: claims.clientId ? String(claims.clientId) : undefined,
        email: claims.email ? String(claims.email) : undefined,
        classId: claims.classId ? String(claims.classId) : undefined
      },
      returnUrl: `${baseUrl}/thanks`,
      cancelUrl: `${baseUrl}/cancel`
    });

    if (payment.checkoutUrl) {
      res.redirect(payment.checkoutUrl);
      return;
    }

    res.json(payment);
  } catch (error) {
    const message = error instanceof Error ? error.message : "checkout error";
    res.status(400).send(`checkout error: ${message}`);
  }
});

const trustedPrice = async (
  tenant: TenantConfig,
  itemId: string,
  itemType: string,
  hintedPrice?: number
): Promise<number> => {
  if (typeof hintedPrice === "number" && Number.isFinite(hintedPrice) && hintedPrice > 0) {
    return hintedPrice;
  }

  const accessToken = await issueUserToken(tenant);
  const services = await listServices(tenant, accessToken);
  const match = services.find((service: MindbodyServiceSummary) => String(service.Id) === String(itemId));

  if (!match) {
    throw new Error("item not found");
  }

  const price = typeof match.Price === "number" ? match.Price : Number(match.Price ?? 0);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("item price missing or invalid");
  }

  return price;
};
