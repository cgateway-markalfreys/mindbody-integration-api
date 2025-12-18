import axios, { AxiosError, AxiosHeaders, AxiosInstance, AxiosRequestHeaders, InternalAxiosRequestConfig } from "axios";
import { createMindbodyClient, mbGet, mbPost, NonJsonResponseError, MindbodyClientOptions } from "./client.js";
import { isCheckoutTest } from "../config/env.js";

export interface MindbodyConfig {
  siteId: number;
  serviceId: string;
  apiKey: string;
  userToken?: string;
  userTokenUsername?: string;
  userTokenPassword?: string;
  caymanPaymentMethodId?: string;
}

export interface MindbodyClientInput {
  email: string;
  firstName: string;
  lastName: string;
  birthDate?: string;
}

export interface MindbodyClientSummary {
  id: number;
  uniqueId?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  birthDate?: string;
  addressLine1?: string;
  city?: string;
  country?: string;
  postalCode?: string;
}

export interface MindbodyCartItem {
  type: string;
  id?: string;
  description: string;
}

export interface MindbodyServiceSummary {
  id: string;
  name?: string;
  price?: number;
}

export interface MindbodySaleInput {
  clientId: number;
  amount: number;
  amountString?: string;
  transactionId?: string;
  creditCardNumber?: string;
  creditCardExpMonth?: string;
  creditCardExpYear?: string;
  cartItem: MindbodyCartItem;
  test?: boolean;
}

export interface MindbodyService {
  ensureClient(client: MindbodyClientInput): Promise<unknown>;
  checkoutSale(sale: MindbodySaleInput): Promise<unknown>;
  ensureUserToken(forceRefresh?: boolean): Promise<string>;
  getServicePrice(serviceId?: string): Promise<number | undefined>;
  getPricingOptionPrice(pricingOptionId: string): Promise<number | undefined>;
  listServices(): Promise<MindbodyServiceSummary[]>;
  listClients(options?: {
    searchText?: string;
    limit?: number;
    offset?: number;
  }): Promise<MindbodyClientSummary[]>;
  getSiteStatus(): Promise<unknown>;
  clearClientCart(clientId: number): Promise<void>;
  addCartItem(input: {
    clientId: number;
    sellType: "service" | "pricingOption";
    sellId: string;
    amount: number;
    description: string;
    externalId?: string;
  }): Promise<void>;
  checkoutCart(input: {
    clientId: number;
    sellType: "service" | "pricingOption";
    sellId: string;
    amount: number;
    description: string;
    externalId?: string;
  }): Promise<unknown>;
}

export const createMindbodyService = (config: MindbodyConfig): MindbodyService => {
  const clientOptions: MindbodyClientOptions = {
    apiKey: config.apiKey,
    siteId: config.siteId,
    userToken: config.userToken
  };

  const client: AxiosInstance = createMindbodyClient(clientOptions);

  const resolveMindbodyBaseUrl = (): string => {
    const raw = process.env.MINDBODY_BASE_URL;
    const fallback = "https://api.mindbodyonline.com/public/v6";
    const value = raw && raw.trim().length > 0 ? raw.trim() : fallback;
    return value.replace(/\/$/, "");
  };

  const resolveApiKey = (): string => {
    const fromEnv = process.env.MINDBODY_API_KEY?.trim();
    if (fromEnv) {
      return fromEnv;
    }

    if (config.apiKey.trim().length > 0) {
      return config.apiKey.trim();
    }

    throw new Error("Mindbody API key is not configured.");
  };

  const resolveSiteId = (): number => {
    const rawEnv = process.env.MINDBODY_SITE_ID;

    if (rawEnv && rawEnv.trim().length > 0) {
      const parsed = Number.parseInt(rawEnv.trim(), 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    if (Number.isFinite(config.siteId)) {
      return config.siteId;
    }

    throw new Error("Mindbody site id is not configured.");
  };

  const stripQuotes = (value: string | undefined): string | undefined => {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();
    const match = trimmed.match(/^"(.*)"$/);
    return match ? match[1] : trimmed;
  };

  const resolveSourceName = (): string => {
    const envValue = stripQuotes(process.env.MINDBODY_SOURCE_NAME);
    if (envValue && envValue.length > 0) {
      return envValue;
    }

    const configValue = stripQuotes(config.userTokenUsername);
    if (configValue && configValue.length > 0) {
      return configValue;
    }

    throw new Error("Mindbody source name is not configured.");
  };

  const resolveSourcePassword = (): string => {
    const envValue = stripQuotes(process.env.MINDBODY_SOURCE_PASSWORD);
    if (envValue && envValue.length > 0) {
      return envValue;
    }

    const configValue = stripQuotes(config.userTokenPassword);
    if (configValue && configValue.length > 0) {
      return configValue;
    }

    throw new Error("Mindbody source password is not configured.");
  };

  const extractAccessToken = (data: unknown): string | undefined => {
    if (!data || typeof data !== "object") {
      return undefined;
    }

    const record = data as Record<string, unknown>;
    const candidates = [
      record.AccessToken,
      record.accessToken,
      record.Token,
      record.token,
      record.UserToken
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    const nestedUser = record.User as Record<string, unknown> | undefined;

    if (nestedUser) {
      for (const nested of [nestedUser.AccessToken, nestedUser.UserToken, nestedUser.Token]) {
        if (typeof nested === "string" && nested.trim().length > 0) {
          return nested.trim();
        }
      }
    }

    return undefined;
  };

  const readEnvUserToken = (): string | undefined => {
    const token = process.env.MINDBODY_USER_TOKEN;
    if (typeof token === "string" && token.trim().length > 0) {
      return token.trim();
    }
    return undefined;
  };

  let cachedUserToken = readEnvUserToken() ?? config.userToken;
  let issuingUserTokenPromise: Promise<string> | null = null;

  const setUserToken = (token: string): string => {
    cachedUserToken = token;
    clientOptions.userToken = token;
    process.env.MINDBODY_USER_TOKEN = token;
    return token;
  };

  const issueUserToken = async (): Promise<string> => {
    const username = resolveSourceName();
    const password = resolveSourcePassword();

    if (!username || !password) {
      throw new Error(
        "Mindbody user token missing. Provide MINDBODY_USER_TOKEN or source credentials MINDBODY_SOURCE_NAME/MINDBODY_SOURCE_PASSWORD."
      );
    }

    const siteIdHeader = resolveSiteId().toString();

    const response = await axios.post(
      `${resolveMindbodyBaseUrl()}/usertoken/issue`,
      {
        Username: username,
        Password: password
      },
      {
        headers: {
          "Api-Key": resolveApiKey(),
          SiteId: siteIdHeader,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        timeout: 12000,
        validateStatus: (status) => status >= 200 && status < 300
      }
    );

    const token = extractAccessToken(response.data);

    if (!token) {
      throw new Error("Mindbody user token issue response did not include an access token");
    }

    return setUserToken(token);
  };

  const toNumberOrUndefined = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  };

  const toTrimmedString = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return value.toString(10);
    }

    return undefined;
  };

  const normalizeDate = (value: unknown): string | undefined => {
    const raw = toTrimmedString(value);
    if (!raw) {
      return undefined;
    }

    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : raw;
  };

  const resolvePaymentMethodId = (): { value: number | string; string: string } => {
    const envRaw = process.env.MINDBODY_CAYMAN_PAYMENT_METHOD_ID;
    const raw = envRaw && envRaw.trim().length > 0 ? envRaw.trim() : config.caymanPaymentMethodId?.trim();

    if (!raw) {
      throw new Error(
        "Mindbody Cayman payment method id missing. Set MINDBODY_CAYMAN_PAYMENT_METHOD_ID to the Custom payment id configured in Mindbody."
      );
    }

    const parsed = Number.parseInt(raw, 10);

    return Number.isFinite(parsed)
      ? { value: parsed, string: parsed.toString(10) }
      : { value: raw, string: raw };
  };

  const ensureUserToken = async (forceRefresh = false): Promise<string> => {
    const envToken = readEnvUserToken();
    if (!forceRefresh && envToken && envToken !== cachedUserToken) {
      cachedUserToken = envToken;
      clientOptions.userToken = envToken;
      return envToken;
    }

    if (!forceRefresh && cachedUserToken) {
      return cachedUserToken;
    }

    if (!issuingUserTokenPromise) {
      issuingUserTokenPromise = issueUserToken()
        .catch((error) => {
          cachedUserToken = undefined;
          throw error;
        })
        .finally(() => {
          issuingUserTokenPromise = null;
        });
    }

    return issuingUserTokenPromise;
  };

  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status = error?.response?.status;
      const originalRequest = error?.config as (InternalAxiosRequestConfig & {
        _mbRetriedWithFreshToken?: boolean;
      }) | undefined;

      if (status === 401 && originalRequest && !originalRequest._mbRetriedWithFreshToken) {
        try {
          const newToken = await ensureUserToken(true);
          originalRequest._mbRetriedWithFreshToken = true;
          if (originalRequest.headers && typeof (originalRequest.headers as AxiosHeaders).set === "function") {
            (originalRequest.headers as AxiosHeaders).set("Authorization", `Bearer ${newToken}`);
          } else {
            originalRequest.headers = {
              ...(originalRequest.headers ?? {}),
              Authorization: `Bearer ${newToken}`
            } as AxiosRequestHeaders;
          }
          return client.request(originalRequest);
        } catch (refreshError) {
          return Promise.reject(refreshError);
        }
      }

      return Promise.reject(error);
    }
  );

  void ensureUserToken(true).catch((error) => {
    console.error("[mindbody] Failed to pre-issue user token", error);
  });

  const loadServices = async (): Promise<MindbodyServiceSummary[]> => {
    const serviceResponse = await mbGet(
      "/sale/services",
      { limit: 200, Test: true },
      client
    );

    const services = (serviceResponse as { Services?: Array<{ Id?: unknown; Name?: unknown; Price?: unknown }> })
      .Services ?? [];

    const parsePrice = (price: unknown): number | undefined => {
      if (typeof price === "number" && Number.isFinite(price)) {
        return price;
      }

      if (typeof price === "string" && price.trim().length) {
        const parsed = Number.parseFloat(price);

        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }

      return undefined;
    };

    return services
      .map(({ Id, Name, Price }) => {
        const id = typeof Id === "string" || typeof Id === "number" ? String(Id) : undefined;
        const name = typeof Name === "string" ? Name : undefined;
        const price = parsePrice(Price);

        if (!id) return undefined;

        return { id, name, price } as MindbodyServiceSummary;
      })
      .filter((service): service is MindbodyServiceSummary => Boolean(service));
  };

  const lookupServicePrice = async (serviceId: string): Promise<number | undefined> => {
    const services = await loadServices();
    const match = services.find(({ id }) => id === serviceId);
    return match?.price;
  };

  const lookupPricingOptionPrice = async (pricingOptionId: string): Promise<number | undefined> => {
    const response = await mbGet(
      "/sale/pricingoptions",
      { limit: 200, Test: true },
      client
    );

    const pricingOptions = (response as { PricingOptions?: Array<{ Id?: unknown; Price?: unknown }> }).PricingOptions ?? [];
    const match = pricingOptions.find(({ Id }) => `${Id}` === pricingOptionId);
    const price = match?.Price;

    return typeof price === "number" && Number.isFinite(price) ? Math.round(price * 100) / 100 : undefined;
  };

  const findMindbodyClientByEmail = async (
    email: string
  ): Promise<{ client: { Id?: number } | undefined; response: unknown }> => {
    const searchRes = await mbGet("/client/clients", { SearchText: email }, client);
    const existingClient = (searchRes as { Clients?: Array<{ Id?: number; Email?: string }> }).Clients?.find(
      ({ Email }) => typeof Email === "string" && Email.toLowerCase() === email.toLowerCase()
    );

    return { client: existingClient, response: searchRes };
  };

  const listClientsInternal = async (options: {
    searchText?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<MindbodyClientSummary[]> => {
    const limitCandidate = Number.isFinite(options.limit) ? Number(options.limit) : 50;
    const offsetCandidate = Number.isFinite(options.offset) ? Number(options.offset) : 0;
    const limit = Math.min(Math.max(Math.floor(limitCandidate), 1), 200);
    const offset = Math.max(Math.floor(offsetCandidate), 0);

    const params: Record<string, unknown> = {
      limit,
      offset
    };

    const searchText = toTrimmedString(options.searchText);
    if (searchText) {
      params.SearchText = searchText;
    }

    const response = await mbGet(
      "/client/clients",
      params,
      client
    );

    const clients = (response as { Clients?: Array<Record<string, unknown>> }).Clients ?? [];

    return clients
      .map((entry): MindbodyClientSummary | undefined => {
        const id = toNumberOrUndefined(entry.Id);
        const uniqueId = toNumberOrUndefined(entry.UniqueId);

        const resolvedId = Number.isFinite(id) ? (id as number) : undefined;
        const fallbackId = Number.isFinite(uniqueId) ? (uniqueId as number) : undefined;

        if (resolvedId === undefined && fallbackId === undefined) {
          return undefined;
        }

        return {
          id: resolvedId ?? (fallbackId as number),
          uniqueId: fallbackId,
          firstName: toTrimmedString(entry.FirstName),
          lastName: toTrimmedString(entry.LastName),
          email: toTrimmedString(entry.Email),
          birthDate: normalizeDate(entry.BirthDate ?? entry.BirthDateString),
          addressLine1: toTrimmedString(entry.AddressLine1 ?? entry.Address ?? entry.Address1),
          city: toTrimmedString(entry.City ?? entry.HomeCity),
          country: toTrimmedString(entry.Country ?? entry.CountryCode),
          postalCode: toTrimmedString(entry.PostalCode ?? entry.Zip ?? entry.Postal)
        };
      })
      .filter((summary): summary is MindbodyClientSummary => Boolean(summary));
  };

  return {
    async ensureClient(clientInput: MindbodyClientInput) {
      await ensureUserToken();

      const payload = {
        Email: clientInput.email,
        FirstName: clientInput.firstName,
        LastName: clientInput.lastName,
        BirthDate: clientInput.birthDate
      };

      console.log(
        "Mindbody request body from Cayman webhook:",
        JSON.stringify(payload, null, 2)
      );

      const lookupResult = await findMindbodyClientByEmail(clientInput.email);

      if (lookupResult.client) {
        console.log("Mindbody client found by email; reusing existing client", lookupResult.client);
        return lookupResult.response;
      }

      try {
        return await mbPost("/client/addclient", payload, client);
      } catch (err: any) {
        const mbErr = err?.response?.data?.Error as { Code?: string } | undefined;

        if (mbErr?.Code === "InvalidClientCreation") {
          const retryLookup = await findMindbodyClientByEmail(clientInput.email);

          if (!retryLookup.client) {
            throw new Error(
              `Duplicate client error from Mindbody, but could not find existing client for email ${clientInput.email}`
            );
          }

          return retryLookup.response;
        }

        throw err;
      }
    },

    async checkoutSale(saleInput: MindbodySaleInput) {
      await ensureUserToken();

      // Service Id must be a valid catalog entry returned by Mindbody /sale/services; associated metadata (including key `id`)
      // should be configured on that service within the Mindbody UI.
      const serviceId = saleInput.cartItem.id ?? config.serviceId;

      if (!serviceId) {
        throw new Error(
          "Mindbody Service Id is missing. Set MINDBODY_SERVICE_ID or provide saleInput.cartItem.id."
        );
      }

      const gatewayAmountString =
        typeof saleInput.amountString === "string"
          ? saleInput.amountString
          : Number.isFinite(saleInput.amount)
            ? saleInput.amount.toFixed(2)
            : "0.00";

      const cleanCreditCardNumber = (value: string | undefined): string | undefined =>
        value?.replace(/\D/g, "").trim() || undefined;

      const creditCardFallbackNumber = "4111111111111111";

      const resolveCreditCardType = (value: string | undefined): string | undefined => {
        if (!value) {
          return undefined;
        }

        if (/^4\d{12,18}$/.test(value)) {
          return "Visa";
        }

        if (/^(5[1-5]\d{14,17}|2(2[2-9]|[3-7])\d{13,16})$/.test(value)) {
          return "MasterCard";
        }

        if (/^3[47]\d{12,17}$/.test(value)) {
          return "AmericanExpress";
        }

        if (/^6(011\d{12,15}|5\d{14,17})$/.test(value)) {
          return "Discover";
        }

        return undefined;
      };

      const servicePrice = await lookupServicePrice(serviceId);
      const amountForMindbody =
        typeof servicePrice === "number" && Number.isFinite(servicePrice)
          ? servicePrice
          : saleInput.amount;

      const paymentAmountString = Number.isFinite(amountForMindbody)
        ? amountForMindbody.toFixed(2)
        : gatewayAmountString;

      const paymentMetadata: Record<string, string> = {
        amount: paymentAmountString,
        // Mindbody requires a creditCardNumber metadata entry for CreditCard payments even when an
        // external gateway handled the real card details. Use Cayman-supplied card metadata when
        // available and fall back to a stable placeholder so the checkout API accepts the request
        // while still recording the Cayman transaction metadata.
        creditCardNumber:
          (() => {
            const cleaned = cleanCreditCardNumber(saleInput.creditCardNumber);

            if (cleaned && cleaned.length >= 13) {
              return cleaned;
            }

            return creditCardFallbackNumber;
          })(),
        creditCardExpMonth: saleInput.creditCardExpMonth?.trim() || "12",
        creditCardExpYear: saleInput.creditCardExpYear?.trim() || "2099",
        // Some Mindbody environments expect shortened expiry keys (`expMonth` / `expYear`).
        // Send both variants to satisfy either validation path.
        expMonth: saleInput.creditCardExpMonth?.trim() || "12",
        expYear: saleInput.creditCardExpYear?.trim() || "2099"
      };

      const inferredCardType = resolveCreditCardType(paymentMetadata.creditCardNumber);
      const resolvedCardType = inferredCardType ?? "Visa";

      // Mindbody's checkout endpoint rejects credit card payments when it cannot determine the
      // card network. Provide the type in both metadata and PaymentInfo so validation passes even
      // when Cayman only shares masked or placeholder numbers.
      paymentMetadata.creditCardType = resolvedCardType;

      const paymentInfo: Record<string, string> = { CardType: resolvedCardType };

      if (paymentMetadata.creditCardNumber) {
        paymentInfo.CreditCardNumber = paymentMetadata.creditCardNumber;
      }

      if (paymentMetadata.creditCardExpMonth) {
        paymentInfo.ExpMonth = paymentMetadata.creditCardExpMonth;
      }

      if (paymentMetadata.creditCardExpYear) {
        paymentInfo.ExpYear = paymentMetadata.creditCardExpYear;
      }

      const configuredPaymentMethodId = config.caymanPaymentMethodId?.trim();
      const parsedPaymentMethodId = configuredPaymentMethodId
        ? Number.parseInt(configuredPaymentMethodId, 10)
        : undefined;

      const paymentPayload = {
        Type: "CreditCard",
        Amount: amountForMindbody,
        PaymentInfo: paymentInfo,
        Metadata: paymentMetadata,
        ...(configuredPaymentMethodId
          ? {
              PaymentMethodId: Number.isFinite(parsedPaymentMethodId)
                ? parsedPaymentMethodId
                : configuredPaymentMethodId
            }
          : {})
      };

      if (
        typeof servicePrice === "number" &&
        Number.isFinite(servicePrice) &&
        Math.abs(servicePrice - saleInput.amount) > 0.009
      ) {
        console.warn("Mindbody service price differs from Cayman payment; using Mindbody price for checkout", {
          serviceId,
          servicePrice,
          gatewayAmount: saleInput.amount,
          gatewayAmountString
        });
        paymentMetadata.gatewayAmount = gatewayAmountString;
      }

      if (saleInput.transactionId) {
        paymentMetadata.gatewayTransactionId = saleInput.transactionId;
      }

      const checkoutTest = isCheckoutTest();

      const descriptionBase =
        saleInput.cartItem.description?.trim().length
          ? saleInput.cartItem.description
          : "Cayman Gateway payment";

      const itemDescription =
        saleInput.transactionId && !descriptionBase.includes(saleInput.transactionId)
          ? `${descriptionBase} (TX: ${saleInput.transactionId})`
          : descriptionBase;

      const payload = {
        ClientId: saleInput.clientId,
        SiteId: resolveSiteId(),
        Test: checkoutTest ? true : false,
        Items: [
          {
            Item: {
              Type: saleInput.cartItem.type,
              Id: serviceId,
              Metadata: {
                // Mindbody expects metadata on the Service with key `id`; include it explicitly
                // to avoid relying on UI configuration.
                id: serviceId
              }
            },
            Quantity: 1,
            Amount: amountForMindbody,
            Description: itemDescription
          }
        ],
        Payments: [
          paymentPayload
        ]
      };

      console.log(
        "Mindbody checkoutshoppingcart payload",
        JSON.stringify(payload, null, 2),
        { clientId: saleInput.clientId, serviceId, transactionId: saleInput.transactionId }
      );

      if (payload.Test) {
        console.warn(
          "[warn] Checkout is in TEST mode. Sale will NOT appear in Mindbody UI. Set MBO_CHECKOUT_TEST=false to persist."
        );
      }

      console.log("Using Mindbody Service Id for sale", {
        serviceId,
        note:
          "Id should match an entry returned by /sale/services; metadata with key 'id' must be configured on that service in the Mindbody UI."
      });

      try {
        return await mbPost("/sale/checkoutshoppingcart", payload, client);
      } catch (err: unknown) {
        const axiosError = err as AxiosError;

        if (axiosError.response?.status === 400) {
          console.error("Mindbody checkout error (400)", {
            error: (axiosError.response?.data as { Error?: unknown } | undefined)?.Error,
            payload
          });
        }


        throw err;
      }
    },

    async getServicePrice(serviceId?: string) {
      const targetServiceId = serviceId ?? config.serviceId;

      if (!targetServiceId) {
        throw new Error(
          "Mindbody Service Id is missing. Set MINDBODY_SERVICE_ID or provide a serviceId."
        );
      }

      return lookupServicePrice(targetServiceId);
    },

    async getPricingOptionPrice(pricingOptionId: string) {
      return lookupPricingOptionPrice(pricingOptionId);
    },

    async listServices() {
      return loadServices();
    },

    async listClients(options) {
      return listClientsInternal(options);
    },

    async ensureUserToken(forceRefresh?: boolean) {
      return ensureUserToken(forceRefresh);
    },

    async getSiteStatus() {
      return mbGet("/site/sites", undefined, client);
    },

    async clearClientCart(clientId: number) {
      try {
        await mbPost("/sale/clearclientcart", { ClientId: clientId, SiteId: resolveSiteId() }, client);
      } catch (error) {
        if (error instanceof NonJsonResponseError && error.details.status === 404) {
          console.warn("Mindbody cart already empty (non-JSON 404)", {
            clientId,
            siteId: resolveSiteId(),
            contentType: error.details.contentType
          });
          return;
        }

        if (axios.isAxiosError(error)) {
          if (error.response?.status === 404 && error.response?.data) {
            console.warn("Mindbody cart already empty", { clientId, siteId: resolveSiteId() });
            return;
          }

          console.error("Failed to clear Mindbody cart", {
            clientId,
            siteId: resolveSiteId(),
            error: error.message
          });
          throw error;
        }

        console.error("Failed to clear Mindbody cart", {
          clientId,
          siteId: resolveSiteId(),
          error: error instanceof Error ? error.message : "unknown_error"
        });
        throw error;
      }
    },
    async addCartItem(input: {
      clientId: number;
      sellType: "service" | "pricingOption";
      sellId: string;
      amount: number;
      description: string;
      externalId?: string;
    }) {
      const paymentMethod = resolvePaymentMethodId();
      const type = input.sellType === "pricingOption" ? "PricingOption" : "Service";
      if (!Number.isFinite(input.amount)) {
        throw new Error("Mindbody checkout amount must be a finite number.");
      }

      const amount = Math.round(input.amount * 100) / 100;
      const amountString = amount.toFixed(2);
      const paymentMetadata: Record<string, string> = {
        amount: amountString,
        id: paymentMethod.string
      };

      if (input.externalId) {
        paymentMetadata.gatewayTransactionId = input.externalId;
      }

      const payload = {
        ClientId: input.clientId,
        SiteId: resolveSiteId(),
        Test: isCheckoutTest() ? true : false,
        Items: [
          {
            Item: {
              Type: type,
              Id: input.sellId,
              Metadata: { id: input.sellId }
            },
            Quantity: 1,
            Amount: amount,
            Description: input.description
          }
        ],
        Payments: [
          {
            Type: "Custom",
            Amount: amount,
            Reference: input.externalId ?? undefined,
            Note: input.description,
            Metadata: paymentMetadata,
            PaymentMethodId: paymentMethod.value
          }
        ],
        ...(input.externalId ? { ExternalReferenceId: input.externalId } : {})
      };

      return mbPost("/sale/checkoutshoppingcart", payload, client);
    },

    async checkoutCart(input: {
      clientId: number;
      sellType: "service" | "pricingOption";
      sellId: string;
      amount: number;
      description: string;
      externalId?: string;
    }) {
      const paymentMethodId = config.caymanPaymentMethodId;
      const type = input.sellType === "pricingOption" ? "PricingOption" : "Service";
      const payload = {
        ClientId: input.clientId,
        SiteId: resolveSiteId(),
        Test: isCheckoutTest() ? true : false,
        Items: [
          {
            Item: {
              Type: type,
              Id: input.sellId,
              Metadata: { id: input.sellId }
            },
            Quantity: 1,
            Amount: input.amount,
            Description: input.description
          }
        ],
        Payments: [
          {
            Type: "External",
            Amount: input.amount,
            Reference: input.externalId ?? undefined,
            Note: input.description,
            ...(paymentMethodId
              ? { PaymentMethodId: Number.parseInt(paymentMethodId, 10) || paymentMethodId }
              : {})
          }
        ],
        ...(input.externalId ? { ExternalReferenceId: input.externalId } : {})
      };

      return mbPost("/sale/checkoutshoppingcart", payload, client);
    }
  };
};
