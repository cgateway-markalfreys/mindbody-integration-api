import { getApiConfig, getLatestApiConfig, type ApiConfig } from "../storage/apiConfig.js";

const sanitize = (value: string | undefined | null): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const candidates = Array.from(
  new Set(
    [
      sanitize(process.env.API_CONFIG_SITE_KEY),
      sanitize(process.env.MINDBODY_SITE_ID),
      "default",
      "primary"
    ].filter((value): value is string => Boolean(value))
  )
);

let config: ApiConfig | undefined;
let appliedSiteKey: string | undefined;
let appliedUpdatedAt: number | undefined;

const applyConfig = (next: ApiConfig): void => {
  const applyValue = (key: string, value: string | undefined): void => {
    if (!value) {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const existing = process.env[key];
    if (existing !== trimmed) {
      process.env[key] = trimmed;
    }
  };

  applyValue("API_CONFIG_SITE_KEY", next.siteKey);
  applyValue("CAYMAN_API_KEY", next.caymanApiKey);
  applyValue("CAYMAN_API_USERNAME", next.caymanApiUsername);
  applyValue("CAYMAN_API_PASSWORD", next.caymanApiPassword);
  applyValue("MINDBODY_API_KEY", next.mindbodyApiKey);
  applyValue("MINDBODY_SOURCE_NAME", next.mindbodySourceName);
  applyValue("MINDBODY_SOURCE_PASSWORD", next.mindbodySourcePassword);
  applyValue("MINDBODY_SITE_ID", next.mindbodySiteId);

  appliedSiteKey = next.siteKey;
  appliedUpdatedAt = next.updatedAt?.getTime();
};

for (const key of candidates) {
  try {
    config = await getApiConfig(key);
  } catch (error) {
    console.error("[config] Failed to load API configuration for site key", key, error);
    config = undefined;
  }
  if (config) {
    break;
  }
}

if (!config) {
  try {
    config = await getLatestApiConfig();
  } catch (error) {
    console.error("[config] Failed to load latest API configuration", error);
  }
}

if (!config) {
  console.warn("[config] No API credentials found in database; falling back to environment variables.");
} else {
  applyConfig(config);
}

const refreshIntervalEnv = Number.parseInt(process.env.API_CONFIG_REFRESH_INTERVAL_MS ?? "", 10);
const refreshIntervalMs = Number.isFinite(refreshIntervalEnv) && refreshIntervalEnv > 0 ? refreshIntervalEnv : 30_000;

const pollLatestConfig = async (): Promise<void> => {
  try {
    const latest = await getLatestApiConfig();

    if (!latest) {
      return;
    }

    const latestTimestamp = latest.updatedAt?.getTime();

    if (
      latest.siteKey !== appliedSiteKey ||
      !appliedUpdatedAt ||
      !latestTimestamp ||
      latestTimestamp > appliedUpdatedAt
    ) {
      applyConfig(latest);
      console.info("[config] Applied refreshed API credentials from database", {
        siteKey: latest.siteKey,
        updatedAt: latest.updatedAt
      });
    }
  } catch (error) {
    console.error("[config] Failed to refresh API credentials from database", error);
  }
};

if (refreshIntervalMs > 0) {
  const timer = setInterval(() => {
    void pollLatestConfig();
  }, refreshIntervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}
