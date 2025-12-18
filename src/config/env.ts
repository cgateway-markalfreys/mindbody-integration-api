import dotenv from "dotenv";

dotenv.config();

// Ensure database-backed credentials hydrate process.env before validation runs.
await import("./loadDbEnv.js");

export interface EnvConfig {
  port: number;
  appBaseUrl: string;
  publicBaseUrl: string;
  linkSigningSecret: string;
  mindbodySiteId: number;
  mindbodyServiceId: string;
  mindbodyBaseUrl: string;
  mindbodyApiKey: string;
  mindbodySourceName: string;
  mindbodySourcePassword: string;
  mindbodyUserToken?: string;
  customPaymentMethodId: number;
  mindbodyCaymanPaymentMethodId?: string;
  caymanWebhookSecret: string;
  cayman: {
    baseUrl: string;
    apiKey: string;
    username: string;
    password: string;
  };
}

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseRequiredInteger = (value: string, name: string): number => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a valid integer.`);
  }

  return parsed;
};

const must = (key: string, fallbackKey?: string): string => {
  const value = process.env[key] ?? (fallbackKey ? process.env[fallbackKey] : undefined);

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

const buildEnv = (): EnvConfig => {
  const required = [
    "PUBLIC_BASE_URL",
    "LINK_SIGNING_SECRET",
    "MINDBODY_SITE_ID",
    "MINDBODY_API_KEY",
    "MINDBODY_SOURCE_NAME",
    "MINDBODY_SOURCE_PASSWORD",
    "CAYMAN_API_KEY",
    "CAYMAN_API_USERNAME",
    "CAYMAN_API_PASSWORD",
    "CAYMAN_API_BASE_URL",
    "CAYMAN_WEBHOOK_SECRET"
  ] as const;

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const mindbodySiteId = parseRequiredInteger(process.env.MINDBODY_SITE_ID as string, "MINDBODY_SITE_ID");
  const rawCustomPaymentMethod = process.env.MINDBODY_CAYMAN_PAYMENT_METHOD_ID;
  const customPaymentMethodId = Number.isFinite(Number.parseInt(rawCustomPaymentMethod ?? "", 10))
    ? Number.parseInt(rawCustomPaymentMethod ?? "", 10)
    : 25;

  const publicBaseUrl = must("PUBLIC_BASE_URL");
  const mindbodyBaseUrl = must("MINDBODY_BASE_URL");
  const caymanBaseUrl = must("CAYMAN_API_BASE_URL", "CAYMAN_BASE_URL");

  return {
    port: toNumber(process.env.PORT, 4000),
    appBaseUrl: publicBaseUrl,
    publicBaseUrl,
    linkSigningSecret: must("LINK_SIGNING_SECRET"),
    mindbodySiteId,
    mindbodyServiceId: process.env.MINDBODY_SERVICE_ID ?? "",
    mindbodyBaseUrl,
    mindbodyApiKey: process.env.MINDBODY_API_KEY as string,
    mindbodySourceName: must("MINDBODY_SOURCE_NAME"),
    mindbodySourcePassword: must("MINDBODY_SOURCE_PASSWORD"),
    mindbodyUserToken: process.env.MINDBODY_USER_TOKEN,
    customPaymentMethodId,
    mindbodyCaymanPaymentMethodId: process.env.MINDBODY_CAYMAN_PAYMENT_METHOD_ID,
    caymanWebhookSecret: must("CAYMAN_WEBHOOK_SECRET"),
    cayman: {
      baseUrl: caymanBaseUrl,
      apiKey: process.env.CAYMAN_API_KEY as string,
      username: process.env.CAYMAN_API_USERNAME as string,
      password: process.env.CAYMAN_API_PASSWORD as string
    }
  };
};

let cachedEnv: EnvConfig | null = null;

export const getEnv = (): EnvConfig => {
  if (!cachedEnv) {
    cachedEnv = buildEnv();
  }

  return cachedEnv;
};

export const env: EnvConfig = getEnv();

export const reloadEnv = (): EnvConfig => {
  const next = buildEnv();

  if (cachedEnv) {
    Object.assign(cachedEnv, next);
    if (cachedEnv.cayman && next.cayman) {
      Object.assign(cachedEnv.cayman, next.cayman);
    }
  } else {
    cachedEnv = next;
  }

  Object.assign(env, cachedEnv);

  return env;
};

export const isCheckoutTest = (): boolean =>
  (process.env.MBO_CHECKOUT_TEST ?? "false").toLowerCase() === "true";
