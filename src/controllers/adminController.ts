import express, { Request, Response } from "express";
import { reloadEnv } from "../config/env.js";
import { getSettings, refreshSettings } from "../config/settings.js";
import { refreshMboClientFromEnv } from "../services/http.js";
import { getApiConfig, getLatestApiConfig, upsertApiConfig, type ApiConfig } from "../storage/apiConfig.js";

const toOptionalTrimmedString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = toOptionalTrimmedString(entry);
      if (match) {
        return match;
      }
    }
  }

  return undefined;
};

const readToken = (
  req: Request,
  field: "secret" | "writeSecret",
  headerName: "x-admin-secret" | "x-admin-write-secret"
): string | undefined =>
  toOptionalTrimmedString(req.query[field]) ??
  toOptionalTrimmedString((req.body as Record<string, unknown> | undefined)?.[field]) ??
  toOptionalTrimmedString(req.headers[headerName]);

const respondError = (
  res: Response,
  status: number,
  error: string,
  extra?: Record<string, unknown>
): void => {
  res.status(status).json({ error, ...(extra ?? {}) });
};

export const requireAdminSecret = (req: Request, res: Response, next: express.NextFunction): void => {
  const { secrets } = getSettings();
  const adminSecret = toOptionalTrimmedString(secrets.admin);

  if (!adminSecret) {
    respondError(res, 401, "ADMIN_SECRET is not configured");
    return;
  }

  const providedSecret = readToken(req, "secret", "x-admin-secret");

  if (providedSecret !== adminSecret) {
    if (req.method === "GET") {
      res.locals.adminAuthRequired = true;
      res.locals.adminAuthError = providedSecret ? "Invalid admin password" : "Admin password required";
      res.locals.adminSecret = "";
      res.locals.adminWriteSecret = "";
      res.locals.adminRequiresWriteSecret = Boolean(secrets.adminWrite);
      next();
      return;
    }

    respondError(res, 401, "Unauthorized: missing or invalid admin secret");
    return;
  }

  res.locals.adminAuthRequired = false;
  res.locals.adminAuthError = undefined;

  const configuredWriteSecret = toOptionalTrimmedString(secrets.adminWrite);
  const requiresWriteSecret = Boolean(configuredWriteSecret);
  const mode = typeof req.query.mode === "string" ? req.query.mode.toLowerCase() : "";
  const needsWriteSecret = req.method === "POST" || mode === "edit";
  const providedWriteSecret = readToken(req, "writeSecret", "x-admin-write-secret");

  let confirmedWriteSecret = "";
  let writeSecretError: string | undefined;

  if (needsWriteSecret) {
    if (requiresWriteSecret) {
      const expectedWriteSecret = configuredWriteSecret as string;

      if (providedWriteSecret !== expectedWriteSecret) {
        if (req.method === "GET") {
          writeSecretError = providedWriteSecret ? "Wrong password" : "Password required";
        } else {
          respondError(res, 401, "Unauthorized: missing or invalid admin write secret", {
            requiresWriteSecret: true
          });
          return;
        }
      } else {
        confirmedWriteSecret = expectedWriteSecret;
      }
    } else {
      const fallbackWriteSecret = providedWriteSecret ?? providedSecret;

      if (fallbackWriteSecret !== providedSecret) {
        if (req.method === "GET") {
          writeSecretError = "Wrong password";
        } else {
          respondError(res, 401, "Unauthorized: invalid admin write secret", {
            requiresWriteSecret
          });
          return;
        }
      } else {
        confirmedWriteSecret = providedSecret;
      }
    }
  } else if (requiresWriteSecret && providedWriteSecret === configuredWriteSecret) {
    confirmedWriteSecret = configuredWriteSecret as string;
  } else if (!requiresWriteSecret && providedWriteSecret === providedSecret) {
    confirmedWriteSecret = providedSecret;
  }

  res.locals.adminSecret = providedSecret;
  res.locals.adminWriteSecret = confirmedWriteSecret;
  res.locals.adminRequiresWriteSecret = requiresWriteSecret;
  res.locals.adminWriteSecretError = writeSecretError;

  if (writeSecretError && needsWriteSecret && req.method === "GET") {
    next();
    return;
  }

  next();
};

const sanitizeInput = (value: string): string => value.trim();

type RenderMode = "view" | "edit";

interface FormValues {
  siteKey: string;
  caymanApiKey: string;
  caymanApiUsername: string;
  caymanApiPassword: string;
  mindbodyApiKey: string;
  mindbodySourceName: string;
  mindbodySourcePassword: string;
  mindbodySiteId: string;
}

interface AdminConfigState {
  mode: RenderMode;
  siteKey: string;
  hasExisting: boolean;
  canEdit: boolean;
  requiresWriteSecret: boolean;
  writeSecretError?: string;
  warning?: string;
  updatedAt?: string;
  defaults: FormValues;
}

const applyConfigToEnv = (config: ApiConfig): void => {
  process.env.CAYMAN_API_KEY = config.caymanApiKey;
  process.env.CAYMAN_API_USERNAME = config.caymanApiUsername;
  process.env.CAYMAN_API_PASSWORD = config.caymanApiPassword;

  if (config.mindbodyApiKey) {
    process.env.MINDBODY_API_KEY = config.mindbodyApiKey;
  }
  if (config.mindbodySourceName) {
    process.env.MINDBODY_SOURCE_NAME = config.mindbodySourceName;
  }
  if (config.mindbodySourcePassword) {
    process.env.MINDBODY_SOURCE_PASSWORD = config.mindbodySourcePassword;
  }
  if (config.mindbodySiteId) {
    process.env.MINDBODY_SITE_ID = config.mindbodySiteId;
  }

  reloadEnv();
  refreshSettings();
  refreshMboClientFromEnv();
};

export const getAdminConfig = async (req: Request, res: Response): Promise<void> => {
  const settings = getSettings();
  const defaultSiteKey = settings.mindbody.siteKey ?? settings.mindbody.siteIdString ?? "default";
  const requestedSiteKey = typeof req.query.siteKey === "string" && req.query.siteKey.trim().length
    ? req.query.siteKey.trim()
    : defaultSiteKey;

  if (res.locals.adminAuthRequired) {
    const error = typeof res.locals.adminAuthError === "string" ? res.locals.adminAuthError : undefined;
    respondError(res, 401, error ?? "Admin password required", {
      siteKey: requestedSiteKey,
      requiresWriteSecret: Boolean(res.locals.adminRequiresWriteSecret)
    });
    return;
  }

  let existingMessage: string | undefined;
  let existing: ApiConfig | undefined;
  let siteKey = requestedSiteKey;

  try {
    existing = await getApiConfig(siteKey);
    if (!existing) {
      const latest = await getLatestApiConfig();
      if (latest) {
        existing = latest;
        siteKey = latest.siteKey;
      }
    }
  } catch (error) {
    console.error("[admin] failed to load existing API configuration", error);
    existingMessage = "Database unavailable. Values below are read from environment variables only.";
  }
  const requestedMode = typeof req.query.mode === "string" ? req.query.mode : undefined;
  const hasExisting = Boolean(existing);
  const writeSecretError = typeof res.locals.adminWriteSecretError === "string" ? res.locals.adminWriteSecretError : undefined;
  const requiresWriteSecret = Boolean(res.locals.adminRequiresWriteSecret);
  const hasWriteSecret = typeof res.locals.adminWriteSecret === "string" && res.locals.adminWriteSecret.length > 0;
  const canEdit = !requiresWriteSecret || hasWriteSecret;
  let mode: RenderMode;

  if (!hasExisting) {
    mode = "edit";
  } else if (requestedMode === "edit" && canEdit) {
    mode = "edit";
  } else {
    mode = "view";
  }

  const blankValues: FormValues = {
    siteKey,
    caymanApiKey: "",
    caymanApiUsername: "",
    caymanApiPassword: "",
    mindbodyApiKey: "",
    mindbodySourceName: "",
    mindbodySourcePassword: "",
    mindbodySiteId: ""
  };

  const envValues: FormValues = {
    siteKey,
    caymanApiKey: settings.env.cayman.apiKey ?? existing?.caymanApiKey ?? "",
    caymanApiUsername: settings.env.cayman.username ?? existing?.caymanApiUsername ?? "",
    caymanApiPassword: settings.env.cayman.password ?? existing?.caymanApiPassword ?? "",
    mindbodyApiKey: settings.env.mindbodyApiKey ?? existing?.mindbodyApiKey ?? "",
    mindbodySourceName: settings.env.mindbodySourceName ?? existing?.mindbodySourceName ?? "",
    mindbodySourcePassword: settings.env.mindbodySourcePassword ?? existing?.mindbodySourcePassword ?? "",
    mindbodySiteId: existing?.mindbodySiteId ?? settings.mindbody.siteIdString ?? ""
  };

  const storedValues: FormValues = {
    siteKey: existing?.siteKey ?? siteKey,
    caymanApiKey: existing?.caymanApiKey ?? envValues.caymanApiKey,
    caymanApiUsername: existing?.caymanApiUsername ?? envValues.caymanApiUsername,
    caymanApiPassword: existing?.caymanApiPassword ?? envValues.caymanApiPassword,
    mindbodyApiKey: existing?.mindbodyApiKey ?? envValues.mindbodyApiKey,
    mindbodySourceName: existing?.mindbodySourceName ?? envValues.mindbodySourceName,
    mindbodySourcePassword: existing?.mindbodySourcePassword ?? envValues.mindbodySourcePassword,
    mindbodySiteId: existing?.mindbodySiteId ?? envValues.mindbodySiteId
  };

  const formValues = canEdit
    ? storedValues
    : hasExisting
      ? blankValues
      : envValues;

  const payload: AdminConfigState = {
    mode,
    siteKey,
    hasExisting,
    canEdit,
    requiresWriteSecret,
    writeSecretError,
    warning: existingMessage,
    updatedAt: existing?.updatedAt ? existing.updatedAt.toISOString() : undefined,
    defaults: formValues
  };

  res.json(payload);
};

export const saveAdminConfig = async (req: Request, res: Response): Promise<void> => {
  const siteKey = sanitizeInput(req.body.siteKey);
  const data = {
    siteKey,
    caymanApiKey: sanitizeInput(req.body.caymanApiKey),
    caymanApiUsername: sanitizeInput(req.body.caymanApiUsername),
    caymanApiPassword: sanitizeInput(req.body.caymanApiPassword),
    mindbodyApiKey: sanitizeInput(req.body.mindbodyApiKey),
    mindbodySourceName: sanitizeInput(req.body.mindbodySourceName),
    mindbodySourcePassword: sanitizeInput(req.body.mindbodySourcePassword),
    mindbodySiteId: sanitizeInput(req.body.mindbodySiteId)
  };

  const writeSecret = typeof req.body.writeSecret === "string" ? sanitizeInput(req.body.writeSecret) : "";
  const requiresWriteSecret = Boolean(res.locals.adminRequiresWriteSecret);

  try {
    const saved = await upsertApiConfig(data);
    applyConfigToEnv(saved);

    res.json({
      status: "ok",
      siteKey,
      hasExisting: true,
      canEdit: !requiresWriteSecret || writeSecret.length > 0,
      requiresWriteSecret,
      updatedAt: saved.updatedAt ? saved.updatedAt.toISOString() : undefined,
      message: "Configuration saved successfully."
    });
  } catch (error) {
    console.error("[admin] failed to save API configuration", error);
    respondError(res, 500, "Unable to save configuration. Check server logs for details.");
  }
};