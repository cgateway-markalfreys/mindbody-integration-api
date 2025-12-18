import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";

export interface MindbodyClientOptions {
  apiKey?: string;
  siteId?: number;
  userToken?: string;
}

const MINDBODY_PUBLIC_V6_BASE_URL = "https://api.mindbodyonline.com/public/v6";

export class NonJsonResponseError extends Error {
  constructor(
    message: string,
    public details: {
      status?: number;
      contentType?: string;
      location?: string;
      snippet?: string;
      xml?: { status?: string; errorCode?: string; message?: string };
      request?: {
        method?: string;
        url?: string;
        baseURL?: string;
        params?: unknown;
        dataSnippet?: string;
      };
    }
  ) {
    super(message);
    this.name = "NonJsonResponseError";
  }
}

export const assertAbsolutePath = (path: string): string => {
  if (typeof path !== "string" || !path.startsWith("/")) {
    const error = new Error(`Mindbody path must be absolute and start with '/': got "${path}"`);
    (error as NodeJS.ErrnoException).code = "RELATIVE_PATH";
    throw error;
  }

  return path;
};

const extractXmlValue = (xml: string, tag: string): string | undefined => {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i"));
  const value = match?.[1]?.trim();
  return value?.length ? value : undefined;
};

const buildNonJsonError = <T>(response: AxiosResponse<T>): NonJsonResponseError => {
  const rawContentType = response.headers?.["content-type"];
  const contentType = typeof rawContentType === "string" ? rawContentType.toLowerCase() : undefined;
  const location =
    typeof response.headers?.location === "string"
      ? response.headers.location
      : typeof (response.headers as Record<string, unknown> | undefined)?.Location === "string"
        ? (response.headers as Record<string, string>).Location
        : undefined;
  const dataString = typeof response.data === "string" ? response.data : undefined;
  const trimmedDataString = dataString?.trim();
  const lowerDataString = trimmedDataString?.toLowerCase();
  const snippet = dataString?.slice(0, 200);
  const isHtml = Boolean(lowerDataString?.startsWith("<!doctype html") || lowerDataString?.startsWith("<html"));
  const isXml =
    !isHtml &&
    Boolean(
      contentType?.includes("xml") ||
        trimmedDataString?.startsWith("<?xml") ||
        /<status>/i.test(trimmedDataString ?? "") ||
        /<errorcode>/i.test(trimmedDataString ?? "")
    );
  const xmlStatus = isXml && dataString ? extractXmlValue(dataString, "Status") : undefined;
  const xmlErrorCode = isXml && dataString ? extractXmlValue(dataString, "ErrorCode") : undefined;
  const xmlMessage = isXml && dataString ? extractXmlValue(dataString, "Message") : undefined;

  let dataSnippet: string | undefined;
  try {
    if (typeof response.config?.data === "string") {
      dataSnippet = response.config.data.slice(0, 200);
    } else if (response.config?.data) {
      dataSnippet = JSON.stringify(response.config.data).slice(0, 200);
    }
  } catch (_err) {
    dataSnippet = "[unserializable request data]";
  }

  const messageBase = `Mindbody API returned non-JSON response (status ${response.status}, content-type ${
    contentType ?? "unknown"
  }${location ? `, location ${location}` : ""})`;

  const decoratedMessage =
    xmlStatus || xmlErrorCode || xmlMessage
      ? `${messageBase} [${[xmlStatus, xmlErrorCode, xmlMessage].filter(Boolean).join(" | ")}]`
      : snippet
        ? `${messageBase}: ${snippet}`
        : messageBase;

  return new NonJsonResponseError(decoratedMessage, {
    status: response.status,
    contentType,
    location,
    snippet,
    xml: isXml ? { status: xmlStatus, errorCode: xmlErrorCode, message: xmlMessage } : undefined,
    request: {
      method: response.config?.method,
      url: response.config?.url,
      baseURL: response.config?.baseURL,
      params: response.config?.params,
      dataSnippet
    }
  });
};

const ensureJsonResponse = <T>(response: AxiosResponse<T>): AxiosResponse<T> => {
  const rawContentType = response.headers?.["content-type"];
  const contentType = typeof rawContentType === "string" ? rawContentType.toLowerCase() : undefined;
  const dataString = typeof response.data === "string" ? response.data : undefined;
  const trimmedDataString = dataString?.trim();
  const lowerDataString = trimmedDataString?.toLowerCase();
  const isHtml = Boolean(lowerDataString?.startsWith("<!doctype html") || lowerDataString?.startsWith("<html"));

  if (contentType?.includes("application/json")) {
    return response;
  }

  if (contentType?.includes("xml") || contentType?.includes("html") || isHtml) {
    throw buildNonJsonError(response);
  }

  if (typeof response.data === "string") {
    if (trimmedDataString?.startsWith("<") || lowerDataString?.startsWith("<!doctype html")) {
      throw buildNonJsonError(response);
    }
  }

  throw buildNonJsonError(response);
};

export const createMindbodyClient = (options: MindbodyClientOptions = {}): AxiosInstance => {
  const resolveApiKey = (): string => {
    const fromEnv = process.env.MINDBODY_API_KEY?.trim();
    if (fromEnv) {
      return fromEnv;
    }

    if (typeof options.apiKey === "string" && options.apiKey.trim().length > 0) {
      return options.apiKey.trim();
    }

    throw new Error("Mindbody client is missing MINDBODY_API_KEY environment variable.");
  };

  const resolveSiteId = (): number => {
    const rawEnv = process.env.MINDBODY_SITE_ID;

    if (typeof rawEnv === "string" && rawEnv.trim().length > 0) {
      const parsed = Number.parseInt(rawEnv.trim(), 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    if (typeof options.siteId === "number" && Number.isFinite(options.siteId)) {
      return options.siteId;
    }

    throw new Error("Mindbody client is missing MINDBODY_SITE_ID environment variable.");
  };

  const resolveBaseUrl = (): string => {
    const fromEnv = process.env.MINDBODY_BASE_URL;
    return (fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : MINDBODY_PUBLIC_V6_BASE_URL).replace(/\/$/, "");
  };

  const applyDefaults = (client: AxiosInstance): void => {
    const apiKey = resolveApiKey();
    const siteIdHeader = resolveSiteId().toString();
    client.defaults.baseURL = `${resolveBaseUrl()}`;
    client.defaults.headers.common["Api-Key"] = apiKey;
    client.defaults.headers.common.SiteId = siteIdHeader;
    client.defaults.headers.common.Accept = "application/json";
    client.defaults.headers.common["Content-Type"] = "application/json";
  };

  const client = axios.create({
    baseURL: resolveBaseUrl(),
    headers: {
      "Api-Key": resolveApiKey(),
      SiteId: resolveSiteId().toString(),
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    maxRedirects: 0,
    timeout: 15000
  });

  client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (config.url) {
      config.url = assertAbsolutePath(config.url);
    }

    const apiKey = resolveApiKey();
    const siteId = resolveSiteId();
    const siteIdHeader = siteId.toString();

    config.headers = config.headers ?? {};
    config.headers["Api-Key"] = apiKey;
    config.headers.SiteId = siteIdHeader;
    config.headers.Accept = "application/json";
    config.headers["Content-Type"] = "application/json";

    const envToken = process.env.MINDBODY_USER_TOKEN?.trim();
    const token = envToken?.length ? envToken : options.userToken;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    const existingParams = (config.params as Record<string, unknown>) ?? {};
    config.params = { ...existingParams, SiteId: siteId };

    let dataSnippet: string | undefined;
    try {
      if (typeof config.data === "string") {
        dataSnippet = config.data.slice(0, 200);
      } else if (config.data) {
        dataSnippet = JSON.stringify(config.data).slice(0, 200);
      }
    } catch (_err) {
      dataSnippet = "[unserializable request data]";
    }

    console.log("Mindbody HTTP request", {
      method: config.method,
      url: config.url,
      baseURL: config.baseURL,
      params: config.params,
      headers: {
        "Api-Key": apiKey,
        SiteId: siteIdHeader,
        Accept: config.headers.Accept ?? (config.headers as Record<string, unknown>).accept,
        "Content-Type":
          config.headers["Content-Type"] ?? (config.headers as Record<string, unknown>)["content-type"],
        hasAuthorization: Boolean(config.headers.Authorization ?? (config.headers as Record<string, unknown>).authorization)
      },
      dataSnippet
    });

    return config;
  });

  client.interceptors.response.use(
    (response) => ensureJsonResponse(response),
    (error) => {
      if (error?.response) {
        ensureJsonResponse(error.response);
      }

      return Promise.reject(error);
    }
  );

  applyDefaults(client);

  return client;
};

let sharedClient: AxiosInstance | null = null;
let sharedSignature: string | null = null;

export const getMindbodyClient = (options: MindbodyClientOptions = {}): AxiosInstance => {
  if (options.apiKey || options.siteId || options.userToken) {
    return createMindbodyClient(options);
  }

  const signature = JSON.stringify({
    apiKey: process.env.MINDBODY_API_KEY,
    siteId: process.env.MINDBODY_SITE_ID,
    baseUrl: process.env.MINDBODY_BASE_URL ?? MINDBODY_PUBLIC_V6_BASE_URL
  });

  if (!sharedClient || signature !== sharedSignature) {
    sharedClient = createMindbodyClient();
    sharedSignature = signature;
  }

  return sharedClient;
};

export async function mbGet<T = unknown>(path: string, params?: unknown, client?: AxiosInstance): Promise<T> {
  const resolvedClient = client ?? getMindbodyClient();
  const response = await resolvedClient.get<T>(assertAbsolutePath(path), { params });
  return response.data;
}

export async function mbPost<T = unknown>(path: string, data: unknown, client?: AxiosInstance): Promise<T> {
  const resolvedClient = client ?? getMindbodyClient();
  const response = await resolvedClient.post<T>(assertAbsolutePath(path), data);
  return response.data;
}
