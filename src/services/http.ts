import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestHeaders,
  type InternalAxiosRequestConfig
} from "axios";
import { reloadEnv } from "../config/env.js";
import { issueStaffUserToken } from "./mindbody.js";

let mboClient: AxiosInstance | undefined;
let refreshingMindbodyToken: Promise<string> | null = null;

const refreshMindbodyUserToken = async (): Promise<string> => {
  if (!refreshingMindbodyToken) {
    refreshingMindbodyToken = (async () => {
      const token = await issueStaffUserToken();
      process.env.MINDBODY_USER_TOKEN = token;
      reloadEnv();
      if (mboClient) {
        applyMboEnv(mboClient);
      }
      return token;
    })().finally(() => {
      refreshingMindbodyToken = null;
    });
  }

  return refreshingMindbodyToken;
};

const applyMboEnv = (client: AxiosInstance): void => {
  const baseURL = process.env.MINDBODY_BASE_URL;
  const siteId = process.env.MINDBODY_SITE_ID ?? "";
  const apiKey = process.env.MINDBODY_API_KEY ?? "";
  const userToken = process.env.MINDBODY_USER_TOKEN;

  client.defaults.baseURL = baseURL;
  client.defaults.timeout = 20_000;
  client.defaults.headers.common["Content-Type"] = "application/json";
  client.defaults.headers.common["Api-Key"] = apiKey;
  client.defaults.headers.common.SiteId = String(siteId);

  if (userToken) {
    client.defaults.headers.common.Authorization = `Bearer ${userToken}`;
  } else {
    delete client.defaults.headers.common.Authorization;
  }
};

const buildMboClient = (): AxiosInstance => {
  const client = axios.create();
  applyMboEnv(client);

  client.interceptors.request.use((config) => {
    applyMboEnv(client);

    const siteId = (process.env.MINDBODY_SITE_ID ?? "").toString().trim();
    const apiKey = (process.env.MINDBODY_API_KEY ?? "").trim();
    const userToken = (process.env.MINDBODY_USER_TOKEN ?? "").trim();
    const baseURL = process.env.MINDBODY_BASE_URL;

    if (!baseURL || !apiKey || !siteId) {
      throw new Error(
        "Mindbody configuration incomplete: ensure MINDBODY_BASE_URL, MINDBODY_API_KEY, and MINDBODY_SITE_ID are set."
      );
    }

    const headers = (config.headers as AxiosRequestHeaders | undefined) ?? ({} as AxiosRequestHeaders);
    headers.Accept = "application/json";
    headers["Content-Type"] = "application/json";
    headers["Api-Key"] = apiKey;
    (headers as Record<string, string>).SiteId = siteId;

    if (userToken) {
      headers.Authorization = `Bearer ${userToken}`;
    } else {
      delete headers.Authorization;
    }

    const existingParams = (config.params ?? {}) as Record<string, unknown>;

    return {
      ...config,
      baseURL,
      headers,
      params: {
        ...existingParams,
        SiteId: siteId
      },
      url: config.url && !config.url.startsWith("/") ? `/${config.url}` : config.url
    };
  });

  return client;
};

export const mbo = (() => {
  mboClient = buildMboClient();
  mboClient.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const originalConfig = axiosError.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

      if (status !== 401 || !originalConfig || originalConfig._retry) {
        return Promise.reject(error);
      }

      originalConfig._retry = true;

      try {
        const token = await refreshMindbodyUserToken();
        const headers = originalConfig.headers ?? {};
        headers.Authorization = `Bearer ${token}`;
        originalConfig.headers = headers;

        return mboClient!.request(originalConfig);
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }
  );
  return mboClient;
})();

export const refreshMboClientFromEnv = (): void => {
  if (!mboClient) {
    mboClient = buildMboClient();
    return;
  }
  applyMboEnv(mboClient);
};

const buildCaymanClient = (): AxiosInstance => {
  const baseURL = process.env.CAYMAN_API_BASE_URL;
  const apiKey = process.env.CAYMAN_API_KEY ?? "";
  const username = process.env.CAYMAN_API_USERNAME ?? "";
  const password = process.env.CAYMAN_API_PASSWORD ?? "";

  return axios.create({
    baseURL,
    timeout: 20_000,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey
    },
    auth: {
      username,
      password
    }
  });
};

export const cayman = buildCaymanClient();
