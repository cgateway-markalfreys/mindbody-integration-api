import "dotenv/config";
import fs from "node:fs";

// Hydrate env vars from the database before we validate required keys.
await import("../config/loadDbEnv.js");

export interface TenantConfig {
  siteId: string;
  label?: string;
  mbApiKey: string;
  staffUser: string;
  staffPass: string;
  customTenderId?: number;
  currency?: string;
}

export const env = {
  APP_BASE_URL: must("APP_BASE_URL", "PUBLIC_BASE_URL"),
  LINK_SIGNING_SECRET: must("LINK_SIGNING_SECRET"),
  CAYMAN_BASE_URL: must("CAYMAN_BASE_URL", "CAYMAN_API_BASE_URL"),
  CAYMAN_API_KEY: must("CAYMAN_API_KEY"),
  CAYMAN_WEBHOOK_SECRET: must("CAYMAN_WEBHOOK_SECRET"),
  MINDBODY_BASE_URL: must("MINDBODY_BASE_URL"),
  TENANTS_PATH: process.env.TENANTS_PATH || "./tenants.json"
};

export interface TenantLookup {
  list: TenantConfig[];
  byId: Map<string, TenantConfig>;
  get: (siteId: string | number) => TenantConfig;
}

export function loadTenants(): TenantLookup {
  const rawTenants = fs.readFileSync(env.TENANTS_PATH, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawTenants);
  } catch (error) {
    throw new Error(`Failed to parse tenants file at ${env.TENANTS_PATH}: ${String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Tenants file at ${env.TENANTS_PATH} must contain an array`);
  }

  const list = parsed.map((entry) => ({
    ...entry,
    siteId: String((entry as TenantConfig).siteId)
  })) as TenantConfig[];

  const byId = new Map<string, TenantConfig>();

  for (const tenant of list) {
    byId.set(String(tenant.siteId), tenant);
  }

  return {
    list,
    byId,
    get: (siteId: string | number): TenantConfig => {
      const tenant = byId.get(String(siteId));
      if (!tenant) {
        throw new Error(`Unknown siteId=${siteId}`);
      }
      return tenant;
    }
  };
}

function must(key: string, fallbackKey?: string): string {
  const value = process.env[key] ?? (fallbackKey ? process.env[fallbackKey] : undefined);
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env ${key}`);
  }
  return value;
}
