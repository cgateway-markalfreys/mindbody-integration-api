import { type RequestHandler } from "express";
import { body, query } from "express-validator";
import { randomUUID } from "node:crypto";
import { save, get, type Session } from "../lib/sessions.js";
import { createHostedPayment, type HostedPaymentBilling } from "../services/cayman.js";
import { getServiceById } from "../services/mbo.js";
import { badRequest, paymentRequired } from "../utils/validate.js";
import { type CaymanCurrency } from "../types/cayman.js";
import { processCaymanNotification, type CaymanNotificationResult } from "../routes/webhooks.js";

const priceFromService = (service: any): number => {
  const candidates = [service?.OnlinePrice, service?.Price, service?.price, service?.OnlinePrice?.Amount];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const parsed = Number.parseFloat(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return NaN;
};

const baseUrl = (): string => {
  const envBase = process.env.PUBLIC_BASE_URL;
  if (envBase && envBase.length > 0) {
    return envBase.replace(/\/$/, "");
  }
  return "http://localhost:4000";
};

const buildAbsoluteUrl = (pathname: string, query?: Record<string, string | number | boolean>): string => {
  const root = baseUrl();

  try {
    const url = new URL(pathname, root);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  } catch (_error) {
    const queryString = query
      ? Object.entries(query)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
          .join("&")
      : "";

    const baseWithPath = pathname.startsWith("/") ? `${root}${pathname}` : `${root}/${pathname}`;
    return queryString.length > 0 ? `${baseWithPath}?${queryString}` : baseWithPath;
  }
};

const defaultBilling: HostedPaymentBilling = {
  street1: process.env.CAYMAN_DEFAULT_STREET1 ?? "1 Demo Way",
  city: process.env.CAYMAN_DEFAULT_CITY ?? "George Town",
  country: (process.env.CAYMAN_DEFAULT_COUNTRY ?? "KY").toUpperCase(),
  zip: process.env.CAYMAN_DEFAULT_ZIP ?? "KY1-1201",
  state: process.env.CAYMAN_DEFAULT_STATE ?? undefined,
  street2: process.env.CAYMAN_DEFAULT_STREET2 ?? undefined,
  phone: process.env.CAYMAN_DEFAULT_PHONE ?? undefined
};

const resolveCurrency = (): CaymanCurrency => {
  const raw = (process.env.CAYMAN_DEFAULT_CURRENCY ?? "USD").toUpperCase();
  return raw === "KYD" ? "KYD" : "USD";
};

const extractFirstString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = extractFirstString(entry);
      if (match) {
        return match;
      }
    }
  }

  return undefined;
};

const normalizeSessionId = (value: unknown): string | undefined => {
  const raw = extractFirstString(value);
  if (!raw) {
    return undefined;
  }

  const cleaned = raw.replace(/[?#].*$/u, "").replace(/&.*$/u, "");
  return cleaned.length > 0 ? cleaned : undefined;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const readMindbodyErrorMessage = (result: CaymanNotificationResult | undefined): string | undefined => {
  const data = result?.mindbody?.data;
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  const error = record.Error ?? record.error;

  if (error && typeof error === "object" && error !== null) {
    const message =
      (error as Record<string, unknown>).Message ?? (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }

  return undefined;
};

const buildBilling = (customer: Record<string, unknown>): HostedPaymentBilling => {
  const addressRaw = customer?.address;
  const address = typeof addressRaw === "object" && addressRaw !== null ? (addressRaw as Record<string, unknown>) : {};

  const pick = (key: keyof HostedPaymentBilling, value: unknown): Partial<HostedPaymentBilling> => {
    if (typeof value === "string" || typeof value === "number") {
      const trimmed = String(value).trim();
      if (trimmed.length > 0) {
        return { [key]: trimmed } as Partial<HostedPaymentBilling>;
      }
    }
    return {};
  };

  const countryRaw = typeof address.country === "string" && address.country.trim().length > 0
    ? address.country
    : typeof customer.country === "string" && customer.country.trim().length > 0
      ? customer.country
      : undefined;

  const zipRaw =
    (typeof address.zip === "string" && address.zip.trim().length > 0 && address.zip) ||
    (typeof address.postal === "string" && address.postal.trim().length > 0 && address.postal) ||
    (typeof customer.zip === "string" && customer.zip.trim().length > 0 && customer.zip) ||
    (typeof customer.postalCode === "string" && customer.postalCode.trim().length > 0 && customer.postalCode) ||
    undefined;

  const street1Raw =
    (typeof address.street1 === "string" && address.street1.trim().length > 0 && address.street1) ||
    (typeof customer.street1 === "string" && customer.street1.trim().length > 0 && customer.street1) ||
    undefined;

  const cityRaw =
    (typeof address.city === "string" && address.city.trim().length > 0 && address.city) ||
    (typeof customer.city === "string" && customer.city.trim().length > 0 && customer.city) ||
    undefined;

  const merged: HostedPaymentBilling = {
    ...defaultBilling,
    ...pick("street1", street1Raw),
    ...pick("city", cityRaw),
    ...pick("country", typeof countryRaw === "string" ? countryRaw.toUpperCase() : undefined),
    ...pick("zip", zipRaw)
  };

  Object.assign(
    merged,
    pick("state", address.state ?? customer.state),
    pick("street2", address.street2 ?? address.address2 ?? customer.street2 ?? customer.address2),
    pick("phone", address.phone ?? customer.phone)
  );

  return merged;
};

export const checkoutValidators = [
  body("siteKey").isString().trim().notEmpty(),
  body("productId").isString().trim().notEmpty(),
  body("qty").optional().isInt({ min: 1 }),
  body("customer.email").isEmail().normalizeEmail(),
  body("customer.firstName").isString().trim().notEmpty(),
  body("customer.lastName").isString().trim().notEmpty()
];

export const checkoutReturnValidators = [query("sessionId").isString().trim().notEmpty()];

export const createCheckoutSessionHandler = (): RequestHandler => async (req, res) => {
  const { siteKey, productId, qty, customer } = req.body as {
    siteKey: string;
    productId: string;
    qty?: number;
    customer: { email: string; firstName: string; lastName: string };
  };

  const desiredProductId = productId.trim();

  if (!desiredProductId) {
    badRequest(res, "product_required", { productId });
    return;
  }

  const service = await getServiceById(desiredProductId);

  if (!service || !service.Id) {
    badRequest(res, "service_not_found", { productId: desiredProductId });
    return;
  }

  const quantity = Number.isInteger(qty) && (qty as number) > 0 ? (qty as number) : 1;
  const unitPrice = priceFromService(service);

  if (!Number.isFinite(unitPrice)) {
    paymentRequired(res, "invalid_service_price", { productId: service.Id });
    return;
  }

  const total = (unitPrice * quantity).toFixed(2);
  const totalNumber = Number.parseFloat(total);
  const sessionId = randomUUID();

  const billing = buildBilling(customer as Record<string, unknown>);
  const currency = resolveCurrency();

  const orderId = `os_${Date.now()}_${sessionId}`;

  const session: Session = {
    id: sessionId,
    siteKey,
    customer: {
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName
    },
    lines: [
      {
        productId: String(service.Id ?? desiredProductId ?? ""),
        name: String(service.Name ?? service.name ?? "Service"),
        unitPrice,
        qty: quantity
      }
    ],
    total: totalNumber,
    status: "created",
    inStore: false,
    cayman: {
      orderId
    }
  };

  let hostedPayment;

  try {
    hostedPayment = await createHostedPayment({
      amount: totalNumber,
      orderId,
      sessionId,
      currency,
      customer: {
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName
      },
      notificationUrl: buildAbsoluteUrl("/webhook/cayman", { sessionId }),
      returnUrl: buildAbsoluteUrl("/v1/checkout/return", { sessionId }),
      cancelUrl: buildAbsoluteUrl("/v1/checkout/return", { sessionId, cancel: 1 }),
      billing,
      receiptText: "Payment complete. You may close this window.",
      siteKey
    });
  } catch (error) {
    paymentRequired(res, "cayman_session_failed", {
      sessionId,
      error: error instanceof Error ? error.message : "Cayman session error"
    });
    return;
  }

  if (!hostedPayment.ok || !hostedPayment.redirectUrl) {
    paymentRequired(res, "cayman_session_failed", { sessionId, response: hostedPayment.raw });
    return;
  }

  save(session);

  res.status(201).json({ redirectUrl: hostedPayment.redirectUrl, sessionId });
};

export const createCheckoutReturnHandler = (): RequestHandler => async (req, res) => {
  const sessionId = normalizeSessionId(req.query.sessionId);

  if (!sessionId) {
    badRequest(res, "invalid_session", { sessionId: req.query.sessionId });
    return;
  }

  const session = get(sessionId);

  if (!session) {
    badRequest(res, "session_not_found", { sessionId });
    return;
  }

  let notificationResult: CaymanNotificationResult | undefined;

  if (session.status !== "paid") {
    try {
      const rawQuery = (() => {
        const url = req.originalUrl ?? "";
        const pos = url.indexOf("?");
        return pos >= 0 && pos < url.length - 1 ? url.slice(pos + 1) : undefined;
      })();

      notificationResult = await processCaymanNotification({
        source: "return",
        query: req.query as Record<string, unknown>,
        rawQuery
      });
    } catch (error) {
      notificationResult = {
        status: "failed",
        detail: error instanceof Error ? error.message : "return_processing_failed"
      } as const;
    }
  }

  const refreshed = get(sessionId) ?? session;

  const responseBody: Record<string, unknown> = {
    status: refreshed.status,
    session: refreshed
  };

  if (notificationResult) {
    responseBody.notification = notificationResult;
  }

  const preferredResponse = req.accepts(["html", "json"]);

  if (preferredResponse === "html") {
    const status = String(refreshed.status ?? "unknown");
    const isPaid = status === "paid";
    const receiptIdCandidate = notificationResult?.receiptId ?? refreshed.cayman?.transactionId;
    const receiptId = typeof receiptIdCandidate === "number" || typeof receiptIdCandidate === "string"
      ? String(receiptIdCandidate)
      : undefined;

    const detail =
      (typeof notificationResult?.detail === "string" && notificationResult.detail.trim().length > 0
        ? notificationResult.detail.trim()
        : undefined) ?? readMindbodyErrorMessage(notificationResult);

    const heading = isPaid
      ? "Payment Successful"
      : status === "processing"
        ? "Payment Processing"
        : "Payment Issue";

    const lead = isPaid
      ? "Thanks! Your payment was processed successfully."
      : detail ?? "We could not complete your payment. Please contact support.";

    const secondary = isPaid
      ? "You can close this window or return to the Mindbody portal."
      : status === "processing"
        ? "We are still confirming your payment. Refresh this page shortly to check again."
        : "No charges were captured. Please try again or reach out to your studio for assistance.";

    const variantClass = isPaid ? "success" : status === "processing" ? "pending" : "error";

    const detailHtml = !isPaid && detail ? `<p class="detail">${escapeHtml(detail)}</p>` : "";
    const receiptHtml = isPaid && receiptId ? `<p class="meta">Reference: ${escapeHtml(receiptId)}</p>` : "";

    const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(heading)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; background:#f9fafb; margin:0; padding:32px; }
  .card { max-width:520px; margin:0 auto; background:#fff; border-radius:20px; padding:32px; box-shadow:0 20px 45px rgba(15,23,42,0.12); }
  .status { margin:0 0 16px; font-size:26px; font-weight:700; color:#0f172a; }
  .lead { margin:0 0 12px; font-size:16px; color:#1f2937; }
  .note { margin:0 0 16px; font-size:14px; color:#475569; }
  .detail { margin:0 0 12px; font-size:14px; color:#b91c1c; }
  .meta { margin:0; font-size:13px; color:#2563eb; }
  .cta { display:inline-block; margin-top:24px; padding:12px 20px; border-radius:12px; font-weight:600; text-decoration:none; }
  .cta.primary { background:#2563eb; color:#fff; }
  .cta.secondary { margin-left:12px; color:#2563eb; }
  .card.success .status { color:#166534; }
  .card.success .cta.primary { background:#16a34a; }
  .card.pending .status { color:#92400e; }
  .card.pending .cta.primary { background:#f59e0b; }
  .card.error .status { color:#b91c1c; }
  .card.error .cta.primary { background:#b91c1c; }
</style>
</head><body>
<div class="card ${variantClass}">
  <h1 class="status">${escapeHtml(heading)}</h1>
  <p class="lead">${escapeHtml(lead)}</p>
  <p class="note">${escapeHtml(secondary)}</p>
  ${detailHtml}
  ${receiptHtml}
  <a class="cta primary" href="${escapeHtml(buildAbsoluteUrl("/"))}" target="_parent" rel="noopener">Return to site</a>
  <a class="cta secondary" href="${escapeHtml(buildAbsoluteUrl("/v1/checkout/return", { sessionId }))}" target="_parent" rel="noopener">Refresh status</a>
</div>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
    return;
  }

  res.json(responseBody);
};

