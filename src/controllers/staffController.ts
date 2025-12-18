import { NextFunction, Request, Response, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { getSettings } from "../config/settings.js";
import { type MindbodyService } from "../mindbody/service.js";
import {
  listServices,
  listProducts,
  listPackages,
  type MindbodyServiceItem,
  type MindbodyProductItem,
  type MindbodyPackageItem
} from "../services/mbo.js";
import { save, get as getSession } from "../lib/sessions.js";
import { createHostedPayment, type HostedPaymentBilling } from "../services/cayman.js";
import { type CaymanCurrency } from "../types/cayman.js";

interface StaffControllerDependencies {
  mindbodyService: MindbodyService;
}

type StaffCatalogType = "Service" | "Product" | "Package";

interface StaffCatalogItem {
  id: string;
  type: StaffCatalogType;
  name: string;
  price: number | null;
  priceDisplay: string | null;
  description?: string;
}

interface StaffPrefill {
  firstName?: string;
  lastName?: string;
  email?: string;
  street1?: string;
  city?: string;
  country?: string;
  zip?: string;
  birthDate?: string;
  mindbodyClientId?: string;
  returnUrl?: string;
}

interface StaffClientResult {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  birthDate?: string;
  street?: string;
  city?: string;
  country?: string;
  postalCode?: string;
}

interface StaffPaySummary {
  warnTest: boolean;
  returnUrl: string;
  currency: CaymanCurrency;
  catalog: StaffCatalogItem[];
  selectedItem: StaffCatalogItem | null;
  prefill: StaffPrefill;
  links: {
    createPayment: string;
    clients: string;
    receipt: string;
  };
}

interface StaffPayRequestBody {
  itemId?: unknown;
  itemType?: unknown;
  serviceId?: unknown;
  serviceType?: unknown;
  mindbodyClientId?: unknown;
  clientId?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  street1?: unknown;
  city?: unknown;
  country?: unknown;
  zip?: unknown;
  birthDate?: unknown;
  secret?: unknown;
  returnUrl?: unknown;
  cancelUrl?: unknown;
}

const MAX_CLIENT_RESULTS = 25;

const trimmed = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const result = value.trim();
    return result.length > 0 ? result : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
};

const normalizeCatalogType = (value: unknown): StaffCatalogType | undefined => {
  const raw = trimmed(value);
  if (!raw) return undefined;
  const lowered = raw.toLowerCase();
  if (lowered === "service") return "Service";
  if (lowered === "product") return "Product";
  if (lowered === "package") return "Package";
  return undefined;
};

const toPrice = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.parseFloat(value.toFixed(2));
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) {
      return Number.parseFloat(parsed.toFixed(2));
    }
  }
  return null;
};

const priceDisplay = (price: number | null): string | null => (price !== null ? price.toFixed(2) : null);

const itemName = (value: unknown, fallback: string): string => {
  const name = trimmed(value);
  return name ?? fallback;
};

const itemId = (value: unknown): string | null => {
  const id = trimmed(value);
  return id ?? null;
};

const isHidden = (record: Record<string, unknown>): boolean => {
  const flags = [
    record.HideDisplay,
    record.IsHidden,
    record.isHidden,
    record.Hide,
    record.hide
  ];
  if (flags.some((flag) => flag === true)) {
    return true;
  }
  if (typeof record.IsOnline === "boolean" && record.IsOnline === false) {
    return true;
  }
  return false;
};

const resolveCurrency = (): CaymanCurrency => getSettings().defaults.cayman.currency;

const baseUrlFromEnv = (): string | undefined => {
  const { urls } = getSettings();
  return urls.baseCandidates[0];
};

const getBaseUrl = (req: Request): string => {
  const envBase = baseUrlFromEnv();
  if (envBase) {
    return envBase;
  }

  const host = req.get("host");
  const proto = req.get("x-forwarded-proto") || req.protocol;
  return host ? `${proto}://${host}` : "http://localhost:4000";
};

const frontendBaseUrlFromEnv = (): string | undefined => {
  const { urls } = getSettings();
  return urls.frontendCandidates[0];
};

const getFrontendBaseUrl = (req: Request): string => {
  const envBase = frontendBaseUrlFromEnv();
  if (envBase) {
    return envBase;
  }

  const originHeader = trimmed(req.get("origin"));
  if (originHeader) {
    return originHeader.replace(/\/$/, "");
  }

  return getBaseUrl(req);
};

const buildAbsoluteUrl = (
  req: Request,
  pathname: string,
  query?: Record<string, string | number | boolean | undefined>
): string => {
  const root = getBaseUrl(req);

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

const buildFrontendUrl = (
  req: Request,
  pathname: string,
  query?: Record<string, string | number | boolean | undefined>
): string => {
  const root = getFrontendBaseUrl(req);

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

const toStaffCatalogItems = (
  services: MindbodyServiceItem[],
  products: MindbodyProductItem[],
  packages: MindbodyPackageItem[]
): StaffCatalogItem[] => {
  const items: StaffCatalogItem[] = [];

  for (const service of services) {
    const id = itemId(service.Id ?? service.id);
    if (!id) continue;
    if (isHidden(service as Record<string, unknown>)) continue;
    const price = toPrice(service.Price ?? service.price ?? service.OnlinePrice);
    items.push({
      id,
      type: "Service",
      name: itemName(service.Name ?? service.name, `Service ${id}`),
      price,
      priceDisplay: priceDisplay(price),
      description:
        trimmed((service as { Description?: unknown }).Description ?? (service as { description?: unknown }).description)
    });
  }

  for (const product of products) {
    const id = itemId(product.Id ?? product.id ?? product.Sku ?? product.SKU);
    if (!id) continue;
    if (isHidden(product as Record<string, unknown>)) continue;
    const price = toPrice(product.Price ?? product.price ?? product.OnlinePrice);
    items.push({
      id,
      type: "Product",
      name: itemName(product.Name ?? product.name, `Product ${id}`),
      price,
      priceDisplay: priceDisplay(price),
      description:
        trimmed((product as { Description?: unknown }).Description ?? (product as { description?: unknown }).description)
    });
  }

  for (const pack of packages) {
    const id = itemId(pack.Id ?? pack.id);
    if (!id) continue;
    if (isHidden(pack as Record<string, unknown>)) continue;
    const price = toPrice(pack.Price ?? pack.price ?? pack.OnlinePrice);
    items.push({
      id,
      type: "Package",
      name: itemName(pack.Name ?? pack.name, `Package ${id}`),
      price,
      priceDisplay: priceDisplay(price),
      description:
        trimmed((pack as { Description?: unknown }).Description ?? (pack as { description?: unknown }).description)
    });
  }

  return items;
};

const pickCatalogItem = (
  catalog: StaffCatalogItem[],
  itemIdRaw?: unknown,
  itemTypeRaw?: unknown
): StaffCatalogItem | null => {
  if (!catalog.length) {
    return null;
  }

  const targetId = trimmed(itemIdRaw);
  const targetType = normalizeCatalogType(itemTypeRaw);

  if (targetId) {
    const direct = catalog.find((item) => item.id === targetId && (!targetType || item.type === targetType));
    if (direct) {
      return direct;
    }
    const fallback = catalog.find((item) => item.id === targetId);
    if (fallback) {
      return fallback;
    }
  }

  if (targetType) {
    const firstOfType = catalog.find((item) => item.type === targetType);
    if (firstOfType) {
      return firstOfType;
    }
  }

  return catalog[0] ?? null;
};

const respondError = (res: Response, status: number, message: string, details?: unknown): void => {
  res.status(status).json({
    error: message,
    details: details ?? null
  });
};

export const requireStaffSecret = (req: Request, res: Response, next: NextFunction): void => {
  const { secrets } = getSettings();
  const expected = trimmed(secrets.staff);
  const provided =
    trimmed(req.query.secret) ??
    trimmed((req.body as Record<string, unknown> | undefined)?.secret) ??
    trimmed(req.header("x-staff-secret"));

  if (!expected) {
    respondError(res, 500, "Staff secret is not configured.");
    return;
  }

  if (!provided || provided !== expected) {
    respondError(res, 401, "Unauthorized: missing or invalid staff secret.");
    return;
  }

  next();
};

const collectPrefill = (source: Record<string, unknown>): StaffPrefill => {
  const prefill: StaffPrefill = {};
  const assign = (key: keyof StaffPrefill, value: unknown) => {
    const trimmedValue = trimmed(value);
    if (trimmedValue) {
      prefill[key] = trimmedValue;
    }
  };

  assign("firstName", source.firstName ?? source.FirstName);
  assign("lastName", source.lastName ?? source.LastName);
  assign("email", source.email ?? source.Email);
  assign("street1", source.street1 ?? source.Street1 ?? source.address);
  assign("city", source.city ?? source.City);
  assign("country", source.country ?? source.Country);
  assign("zip", source.zip ?? source.Zip ?? source.postalCode);
  assign("birthDate", source.birthDate ?? source.BirthDate);
  assign("mindbodyClientId", source.mindbodyClientId ?? source.clientId);
  assign("returnUrl", source.returnUrl);

  return prefill;
};

export const createGetStaffPaySummaryHandler = (): RequestHandler => async (req, res) => {
  const query = req.query as Record<string, unknown>;
  const defaultReturnUrl = buildFrontendUrl(req, "/staff/pay/receipt");
  const requestedReturnUrl = trimmed(query.returnUrl) ?? trimmed((query as Record<string, unknown>).return_url);
  const returnUrl = requestedReturnUrl ?? defaultReturnUrl;
  const settings = getSettings();

  try {
    const [services, products, packages] = await Promise.all([listServices(), listProducts(), listPackages()]);
    const catalog = toStaffCatalogItems(services, products, packages);

    if (!catalog.length) {
      respondError(res, 502, "Unable to load Mindbody catalog items.");
      return;
    }

    const requestedItemId =
      trimmed(query.itemId) ??
      trimmed((query as Record<string, unknown>).item_id) ??
      trimmed(query.serviceId) ??
      trimmed((query as Record<string, unknown>).service_id) ??
      trimmed(settings.mindbody.defaultServiceId);
    const requestedType =
      normalizeCatalogType(query.itemType) ??
      normalizeCatalogType((query as Record<string, unknown>).item_type) ??
      normalizeCatalogType(query.serviceType) ??
      normalizeCatalogType((query as Record<string, unknown>).service_type);

    const selectedItem = pickCatalogItem(catalog, requestedItemId, requestedType);

    const payload: StaffPaySummary = {
      warnTest: settings.flags.mboCheckoutTest,
      returnUrl,
      currency: settings.defaults.cayman.currency,
      catalog,
      selectedItem,
      prefill: collectPrefill(query),
      links: {
        createPayment: "/staff/pay",
        clients: "/staff/clients",
        receipt: "/staff/receipt"
      }
    };

    res.json(payload);
  } catch (error) {
    console.error("[staff] failed to load payment metadata", error);
    respondError(res, 502, "Unable to prepare staff checkout data.");
  }
};

export const createStaffPayHandler = (): RequestHandler => async (req, res) => {
  const body = req.body as StaffPayRequestBody;
  const settings = getSettings();
  const currency = settings.defaults.cayman.currency;
  const billingDefaults = settings.defaults.cayman;

  try {
    const [services, products, packages] = await Promise.all([listServices(), listProducts(), listPackages()]);
    const catalog = toStaffCatalogItems(services, products, packages);

    if (!catalog.length) {
      respondError(res, 502, "Unable to load Mindbody catalog items.");
      return;
    }

    const selectedItem = pickCatalogItem(
      catalog,
      body.itemId ?? body.serviceId ?? settings.mindbody.defaultServiceId,
      body.itemType ?? body.serviceType
    );

    if (!selectedItem || selectedItem.price === null || selectedItem.price <= 0) {
      respondError(res, 400, "Unable to determine catalog item price for Cayman payment.");
      return;
    }

    const sessionId = randomUUID();
    const siteKey = String(settings.mindbody.siteKey ?? settings.mindbody.siteIdString ?? "default");
    const orderId = `staff_${Date.now()}_${sessionId}`;
    const amount = Number.parseFloat(selectedItem.price.toFixed(2));

    const customerFirstName = trimmed(body.firstName) ?? "Guest";
    const customerLastName = trimmed(body.lastName) ?? "Checkout";
    const customerEmail = trimmed(body.email);

    if (!customerEmail) {
      respondError(res, 400, "email is required.");
      return;
    }

    const clientId = trimmed(body.mindbodyClientId ?? body.clientId);

    save({
      id: sessionId,
      siteKey,
      customer: {
        email: customerEmail,
        firstName: customerFirstName,
        lastName: customerLastName
      },
      lines: [
        {
          productId: selectedItem.id,
          name: selectedItem.name,
          unitPrice: amount,
          qty: 1,
          type: selectedItem.type
        }
      ],
      total: amount,
      status: "created",
      inStore: selectedItem.type === "Product",
      ...(clientId ? { clientId } : {}),
      cayman: {
        orderId
      }
    });

    const billing: HostedPaymentBilling = {
      street1: trimmed(body.street1) ?? billingDefaults.street1,
      city: trimmed(body.city) ?? billingDefaults.city,
      country: (trimmed(body.country) ?? billingDefaults.country).toUpperCase(),
      zip: trimmed(body.zip) ?? billingDefaults.zip,
      state: billingDefaults.state,
      street2: billingDefaults.street2,
      phone: billingDefaults.phone
    };

    const returnUrl =
      trimmed(body.returnUrl) ??
      buildFrontendUrl(req, "/staff/pay/receipt", {
        sessionId,
        orderId
      });
    const cancelUrl =
      trimmed(body.cancelUrl) ??
      buildFrontendUrl(req, "/staff/pay/receipt", {
        sessionId,
        orderId,
        cancel: 1
      });
    const notificationUrl = buildAbsoluteUrl(req, "/webhook/cayman", { sessionId, source: "staff" });

    const hostedPayment = await createHostedPayment({
      amount,
      orderId,
      sessionId,
      currency,
      customer: {
        email: customerEmail,
        firstName: customerFirstName,
        lastName: customerLastName
      },
      notificationUrl,
      returnUrl,
      cancelUrl,
      billing,
      receiptText: "Payment complete. You may close this window.",
      siteKey
    });

    if (!hostedPayment.ok || !hostedPayment.redirectUrl) {
      console.error("[staff] hosted payment failed", hostedPayment.raw);
      respondError(res, 502, "Failed to prepare Cayman checkout session.", hostedPayment.raw);
      return;
    }

    res.json({
      redirectUrl: hostedPayment.redirectUrl,
      sessionId,
      orderId
    });
  } catch (error) {
    console.error("[staff] failed to start hosted payment", error);
    respondError(res, 502, "Failed to start payment.");
  }
};

export const createGetStaffClientsHandler = ({ mindbodyService }: StaffControllerDependencies): RequestHandler => async (
  req,
  res
) => {
  const query = trimmed(req.query.q ?? req.query.query ?? req.query.searchText);
  if (!query) {
    respondError(res, 400, "q is required.");
    return;
  }

  const limitCandidate = trimmed(req.query.limit);
  const limit = limitCandidate ? Number.parseInt(limitCandidate, 10) : MAX_CLIENT_RESULTS;
  const resolvedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_CLIENT_RESULTS) : MAX_CLIENT_RESULTS;

  try {
    const clients = await mindbodyService.listClients({ searchText: query, limit: resolvedLimit });
    const results: StaffClientResult[] = clients.reduce<StaffClientResult[]>((acc, client) => {
      const id = client.id ?? client.uniqueId;
      if (id === undefined || id === null) {
        return acc;
      }

      acc.push({
        id: String(id),
        firstName: client.firstName ?? undefined,
        lastName: client.lastName ?? undefined,
        email: client.email ?? undefined,
        birthDate: client.birthDate ?? undefined,
        street: client.addressLine1 ?? undefined,
        city: client.city ?? undefined,
        country: client.country ?? undefined,
        postalCode: client.postalCode ?? undefined
      });

      return acc;
    }, []);

    res.json({
      query,
      count: results.length,
      clients: results
    });
  } catch (error) {
    console.error("[staff] client search failed", error);
    respondError(res, 502, "Failed to search Mindbody clients.");
  }
};

export const createGetStaffReceiptHandler = (): RequestHandler => async (req, res) => {
  const preferredType = req.accepts(["json", "html"]);

  if (preferredType === "html") {
    const queryParams = Object.entries(req.query).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === "string" && value.length > 0) {
        acc[key] = value;
      } else if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (typeof first === "string" && first.length > 0) {
          acc[key] = first;
        } else if (first !== undefined && first !== null) {
          acc[key] = String(first);
        }
      } else if (value !== undefined && value !== null) {
        acc[key] = String(value);
      }
      return acc;
    }, {});

    const redirectUrl = buildFrontendUrl(req, "/staff/pay/receipt", queryParams);
    res.redirect(302, redirectUrl);
    return;
  }

  const sessionId = trimmed(req.query.sessionId);
  const transactionId = trimmed(req.query.tx ?? req.query.transactionId);
  const amountRaw = trimmed(req.query.amount);
  const canceled = trimmed(req.query.cancel) === "1";
  const errorMessage = trimmed(req.query.errorMessage ?? req.query.error);

  const session = sessionId ? getSession(sessionId) : undefined;
  const amountFromQuery = amountRaw ? Number.parseFloat(amountRaw) : undefined;
  const hasAmount = Number.isFinite(amountFromQuery);

  const response = {
    sessionId: sessionId ?? null,
    transactionId: transactionId ?? null,
    amount: hasAmount ? Number.parseFloat((amountFromQuery as number).toFixed(2)) : session?.total ?? null,
    currency: resolveCurrency(),
    canceled,
    status: canceled ? "cancelled" : session?.status ?? (transactionId ? "completed" : "pending"),
    customer: session?.customer ?? null,
    items: session?.lines ?? [],
    message: errorMessage ?? null
  };

  res.json(response);
};

export type { StaffControllerDependencies, StaffPaySummary, StaffCatalogItem };