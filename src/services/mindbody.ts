import axios from "axios";
import { env } from "../config/env.js";

const mindbodyClient = axios.create({
  baseURL: env.mindbodyBaseUrl,
  headers: {
    "Api-Key": env.mindbodyApiKey,
    Accept: "application/json",
    "Content-Type": "application/json"
  },
  timeout: 12_000,
  validateStatus: (status) => status >= 200 && status < 300
});

const withAuthHeader = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`
});

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

export const issueStaffUserToken = async (): Promise<string> => {
  const response = await mindbodyClient.post("/usertoken/issue", {
    Username: env.mindbodySourceName,
    Password: env.mindbodySourcePassword,
    SiteId: env.mindbodySiteId
  });

  const token = extractAccessToken(response.data);

  if (!token) {
    throw new Error("Mindbody /usertoken/issue response did not include an access token");
  }

  return token;
};

export interface MindbodyClientSummary {
  Id: number;
  UniqueId?: number;
  Email?: string;
}

export const upsertClient = async (
  accessToken: string,
  email: string,
  firstName = "Guest",
  lastName = "Checkout"
): Promise<MindbodyClientSummary> => {
  if (!email) {
    throw new Error("upsertClient requires email");
  }

  const response = await mindbodyClient.post(
    "/client/clients",
    {
      SiteId: env.mindbodySiteId,
      Clients: [
        {
          FirstName: firstName,
          LastName: lastName,
          Email: email
        }
      ]
    },
    {
      headers: withAuthHeader(accessToken)
    }
  );

  const client = (response.data as { Clients?: MindbodyClientSummary[] } | undefined)?.Clients?.[0];

  if (!client?.Id) {
    throw new Error("Mindbody failed to return a client id");
  }

  return client;
};

export interface CheckoutShoppingCartInput {
  clientId: number | string;
  itemId: number | string;
  itemType: string;
  amountPaid: number;
  notes?: string;
}

export const checkoutShoppingCart = async (
  accessToken: string,
  input: CheckoutShoppingCartInput
): Promise<unknown> => {
  const amount = Number.isFinite(input.amountPaid) ? Number(input.amountPaid) : 0;

  const response = await mindbodyClient.post(
    "/sale/checkoutshoppingcart",
    {
      SiteId: env.mindbodySiteId,
      ClientId: input.clientId,
      Items: [
        {
          Item: {
            Id: input.itemId,
            Type: input.itemType
          },
          Quantity: 1
        }
      ],
      Payments: [
        {
          Type: "Custom",
          CustomPaymentMethodId: env.customPaymentMethodId,
          Amount: amount
        }
      ],
      InStore: true,
      Test: false,
      SendEmail: true,
      Notes: input.notes ? input.notes.slice(0, 255) : undefined
    },
    {
      headers: withAuthHeader(accessToken)
    }
  );

  return response.data;
};

export interface MindbodyServiceSummary {
  Id?: number | string;
  Name?: string;
  Price?: number | string;
}

export const listServices = async (accessToken: string): Promise<MindbodyServiceSummary[]> => {
  const response = await mindbodyClient.get("/site/services", {
    params: {
      SiteId: env.mindbodySiteId
    },
    headers: withAuthHeader(accessToken)
  });

  const services = (response.data as { Services?: MindbodyServiceSummary[] } | undefined)?.Services;
  return Array.isArray(services) ? services : [];
};
