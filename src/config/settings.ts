import { getEnv as getCoreEnv, reloadEnv as reloadCoreEnv, type EnvConfig } from "./env.js";
import { type CaymanCurrency } from "../types/cayman.js";

type OptionalString = string | undefined;

interface UrlSettings {
  publicBase: string;
  appBase: string;
  baseCandidates: string[];
  frontendCandidates: string[];
}

interface SecretSettings {
  admin?: string;
  adminWrite?: string;
  staff?: string;
}

interface CaymanDefaults {
  street1: string;
  street2?: string;
  city: string;
  state?: string;
  zip: string;
  country: string;
  phone?: string;
  currency: CaymanCurrency;
}

interface MindbodySettings {
  siteId: number;
  siteIdString: string;
  siteKey?: string;
  defaultServiceId?: string;
}

interface FlagSettings {
  mboCheckoutTest: boolean;
}

export interface AppSettings {
  env: EnvConfig;
  urls: UrlSettings;
  secrets: SecretSettings;
  defaults: {
    cayman: CaymanDefaults;
  };
  flags: FlagSettings;
  mindbody: MindbodySettings;
}

const trimmed = (value: unknown): OptionalString => {
  if (typeof value !== "string") {
    return undefined;
  }
  const result = value.trim();
  return result.length > 0 ? result : undefined;
};

const normalizeUrl = (value: string): string => value.replace(/\/+$/u, "");

const uniqueList = (values: Array<OptionalString>): string[] => {
  const seen = new Set<string>();
  const list: string[] = [];

  for (const value of values) {
    if (!value) continue;
    const normalized = normalizeUrl(value);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    list.push(normalized);
  }

  return list;
};

const parseCurrency = (value: OptionalString): CaymanCurrency => {
  const normalized = (value ?? "USD").toUpperCase();
  return normalized === "KYD" ? "KYD" : "USD";
};

const parseBoolean = (value: OptionalString, defaultValue = false): boolean => {
  if (!value) {
    return defaultValue;
  }
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return defaultValue;
};

const buildSettings = (): AppSettings => {
  const envConfig = getCoreEnv();

  const staffSecret = trimmed(process.env.STAFF_SECRET);
  const adminSecret = trimmed(process.env.ADMIN_SECRET) ?? staffSecret;
  const adminWriteSecret = trimmed(process.env.ADMIN_WRITE_SECRET);

  const publicBase = normalizeUrl(envConfig.publicBaseUrl);
  const appBaseRaw = trimmed(process.env.APP_BASE_URL);
  const appBase = normalizeUrl(appBaseRaw ?? envConfig.appBaseUrl ?? envConfig.publicBaseUrl);

  const baseCandidates = uniqueList([publicBase, appBase]);
  const frontendCandidates = uniqueList([
    trimmed(process.env.STAFF_FRONTEND_BASE_URL),
    trimmed(process.env.FRONTEND_BASE_URL),
    trimmed(process.env.CLIENT_BASE_URL),
    trimmed(process.env.PUBLIC_FRONTEND_URL),
    trimmed(process.env.NEXT_PUBLIC_FRONTEND_URL)
  ]);

  const caymanDefaults: CaymanDefaults = {
    street1: trimmed(process.env.CAYMAN_DEFAULT_STREET1) ?? "1 Demo Way",
    street2: trimmed(process.env.CAYMAN_DEFAULT_STREET2),
    city: trimmed(process.env.CAYMAN_DEFAULT_CITY) ?? "George Town",
    state: trimmed(process.env.CAYMAN_DEFAULT_STATE),
    zip: trimmed(process.env.CAYMAN_DEFAULT_ZIP) ?? "KY1-1201",
    country: (trimmed(process.env.CAYMAN_DEFAULT_COUNTRY) ?? "KY").toUpperCase(),
    phone: trimmed(process.env.CAYMAN_DEFAULT_PHONE),
    currency: parseCurrency(trimmed(process.env.CAYMAN_DEFAULT_CURRENCY))
  };

  const mindbodySiteIdString = trimmed(process.env.MINDBODY_SITE_ID) ?? String(envConfig.mindbodySiteId);

  const mindbodySettings: MindbodySettings = {
    siteId: envConfig.mindbodySiteId,
    siteIdString: mindbodySiteIdString,
    siteKey: trimmed(process.env.API_CONFIG_SITE_KEY),
    defaultServiceId: trimmed(process.env.MINDBODY_SERVICE_ID)
  };

  const flags: FlagSettings = {
    mboCheckoutTest: parseBoolean(trimmed(process.env.MBO_CHECKOUT_TEST))
  };

  return {
    env: envConfig,
    urls: {
      publicBase,
      appBase,
      baseCandidates,
      frontendCandidates
    },
    secrets: {
      admin: adminSecret,
      adminWrite: adminWriteSecret,
      staff: staffSecret
    },
    defaults: {
      cayman: caymanDefaults
    },
    flags,
    mindbody: mindbodySettings
  };
};

let cachedSettings: AppSettings | null = null;

export const getSettings = (): AppSettings => {
  if (!cachedSettings) {
    cachedSettings = buildSettings();
  }
  return cachedSettings;
};

export const refreshSettings = (): AppSettings => {
  cachedSettings = buildSettings();
  return cachedSettings;
};

export const reloadSettings = (): AppSettings => {
  reloadCoreEnv();
  return refreshSettings();
};