import axios from "axios";
import { isAxiosError } from "axios";
import { type CaymanConsumerResponse, type CaymanCurrency } from "../types/cayman.js";
import { getApiConfig } from "../storage/apiConfig.js";

interface CaymanApiCredentials {
  baseUrl: string;
  apiKey: string;
  username: string;
  password: string;
}

const sanitizeSiteKey = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const envCredentials = (baseUrl: string): CaymanApiCredentials | undefined => {
  const apiKey = process.env.CAYMAN_API_KEY?.trim();
  const username = process.env.CAYMAN_API_USERNAME?.trim();
  const password = process.env.CAYMAN_API_PASSWORD ?? "";

  if (!apiKey || !username) {
    return undefined;
  }

  return {
    baseUrl,
    apiKey,
    username,
    password
  } satisfies CaymanApiCredentials;
};

const resolveCaymanCredentials = async (siteKey?: string): Promise<CaymanApiCredentials> => {
    const baseUrl = process.env.CAYMAN_API_BASE_URL?.trim();

    if (!baseUrl) {
      throw new Error("CAYMAN_API_BASE_URL environment variable is required.");
    }

  const candidates = Array.from(
    new Set(
      [
        sanitizeSiteKey(siteKey),
        sanitizeSiteKey(process.env.MINDBODY_SITE_ID),
        "default"
      ].filter((value): value is string => Boolean(value))
    )
  );

  for (const key of candidates) {
    try {
      const config = await getApiConfig(key);
      if (config) {
        return {
          baseUrl,
          apiKey: config.caymanApiKey,
          username: config.caymanApiUsername,
          password: config.caymanApiPassword
        } satisfies CaymanApiCredentials;
      }
    } catch (error) {
      console.error("[cayman] failed to load API config", { siteKey: key, error });
    }
  }

  const fallback = envCredentials(baseUrl);
  if (fallback) {
    return fallback;
  }

  throw new Error("Cayman API credentials are not configured. Use /admin/config to provide them or set environment variables.");
};

export interface HostedPaymentCustomer {
  email: string;
  firstName: string;
  lastName: string;
}

export interface HostedPaymentBilling {
  street1: string;
  city: string;
  country: string;
  zip: string;
  state?: string;
  street2?: string;
  phone?: string;
}

export interface HostedPaymentInput {
  amount: string | number;
  orderId: string;
  sessionId: string;
  currency: CaymanCurrency;
  customer: HostedPaymentCustomer;
  notificationUrl: string;
  returnUrl: string;
  cancelUrl?: string;
  billing?: Partial<HostedPaymentBilling>;
  receiptText?: string;
  siteKey?: string;
}

export interface HostedPaymentResponse<T = CaymanConsumerResponse> {
  ok: boolean;
  redirectUrl?: string;
  raw: T | CaymanErrorDetails;
}

export interface CaymanErrorDetails {
  status?: number;
  statusText?: string;
  data?: unknown;
  headers?: unknown;
  message?: string;
}

export const createHostedPayment = async <T = any>(
  input: HostedPaymentInput
): Promise<HostedPaymentResponse<T>> => {
  const credentials = await resolveCaymanCredentials(input.siteKey);

  const amountNumber = typeof input.amount === "number" ? input.amount : Number.parseFloat(String(input.amount));
  const normalizedAmount = Number.isFinite(amountNumber)
    ? Number.parseFloat(amountNumber.toFixed(2))
    : Number.parseFloat(String(input.amount));

  if (!Number.isFinite(normalizedAmount)) {
    throw new Error("Invalid amount supplied for Cayman hosted payment");
  }

  const defaultBilling: HostedPaymentBilling = {
    street1: process.env.CAYMAN_DEFAULT_STREET1 ?? "1 Demo Way",
    city: process.env.CAYMAN_DEFAULT_CITY ?? "George Town",
    country: (process.env.CAYMAN_DEFAULT_COUNTRY ?? "KY").toUpperCase(),
    zip: process.env.CAYMAN_DEFAULT_ZIP ?? "KY1-1201",
    state: process.env.CAYMAN_DEFAULT_STATE ?? undefined,
    street2: process.env.CAYMAN_DEFAULT_STREET2 ?? undefined,
    phone: process.env.CAYMAN_DEFAULT_PHONE ?? undefined
  };

  const billing: HostedPaymentBilling = {
    ...defaultBilling,
    ...(input.billing ?? {})
  };

  const salePayload: Record<string, unknown> = {
    "api-key": credentials.apiKey,
    notificationUrl: input.notificationUrl,
    firstName: input.customer.firstName,
    lastName: input.customer.lastName,
    email: input.customer.email,
    street1: billing.street1,
    city: billing.city,
    country: billing.country,
    zip: billing.zip,
    amount: normalizedAmount,
    currency: input.currency,
    returnUrl: input.returnUrl
  };

  if (billing.state) salePayload.state = billing.state;
  if (billing.street2) salePayload.street2 = billing.street2;
  if (billing.phone) salePayload.phone = billing.phone;
  if (input.receiptText) salePayload.receiptText = input.receiptText;
  if (input.orderId) salePayload.invoiceno = input.orderId;
  if (input.sessionId) {
    salePayload["customfield-data"] = JSON.stringify({ sessionId: input.sessionId });
  }

  try {
    const client = axios.create({
      baseURL: credentials.baseUrl,
      timeout: 20_000,
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": credentials.apiKey
      },
      auth: {
        username: credentials.username,
        password: credentials.password
      }
    });

    const response = await client.post<CaymanConsumerResponse>("/three-step", {
      sale: salePayload
    });

    const data = response.data as CaymanConsumerResponse;
    const success = isOk(data);
    const redirectUrl =
      data?.["consumer-url"] ??
      (data as Record<string, unknown>)?.consumerUrl ??
      (data as Record<string, unknown>)?.redirect_url ??
      (data as Record<string, unknown>)?.redirectUrl;

    return {
      ok: success,
      redirectUrl: typeof redirectUrl === "string" ? redirectUrl : undefined,
      raw: (data as unknown) as T
    };
  } catch (error) {
    if (isAxiosError(error)) {
      // Preserve the most useful bits of the Cayman response for troubleshooting.
      const detail: CaymanErrorDetails = {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        headers: error.response?.headers
      };

      return {
        ok: false,
        raw: detail
      };
    }

    return {
      ok: false,
      raw: {
        message: error instanceof Error ? error.message : "Unknown Cayman error"
      } satisfies CaymanErrorDetails
    };
  }
};

export const isOk = (data: any): boolean => {
  if (!data || typeof data !== "object") {
    return false;
  }

  const code = String(data.result_code ?? data.resultCode ?? data.code ?? "").trim();

  if (code.length === 0) {
    return true;
  }

  return code === "000" || code === "0" || code.startsWith("2");
};
