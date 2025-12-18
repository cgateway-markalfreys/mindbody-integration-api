import { AxiosInstance } from "axios";
import { http } from "../lib/http.js";
import { TenantConfig, env } from "../lib/env.js";

export interface MindbodyServiceSummary {
  Id?: number | string;
  Name?: string;
  Price?: number | string;
}

export interface MindbodyClientSummary {
  Id?: number | string;
  UniqueId?: number | string;
  Email?: string;
}

export interface CheckoutShoppingCartInput {
  clientId: number | string;
  itemId: number | string;
  itemType: string;
  amountPaid: number;
  notes?: string;
}

export const mbClient = (tenant: TenantConfig): AxiosInstance =>
  http(env.MINDBODY_BASE_URL, {
    "Api-Key": tenant.mbApiKey
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
    (record.User as Record<string, unknown> | undefined)?.AccessToken,
    (record.User as Record<string, unknown> | undefined)?.UserToken
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return undefined;
};

export const issueUserToken = async (tenant: TenantConfig): Promise<string> => {
  const client = mbClient(tenant);
  const response = await client.post("/usertoken/issue", {
    Username: tenant.staffUser,
    Password: tenant.staffPass,
    SiteId: tenant.siteId
  });

  const token = extractAccessToken(response.data);

  if (!token) {
    throw new Error("Mindbody /usertoken/issue response did not include an access token");
  }

  return token;
};

export const listServices = async (
  tenant: TenantConfig,
  accessToken: string
): Promise<MindbodyServiceSummary[]> => {
  const client = mbClient(tenant);

  const response = await client.get("/site/services", {
    params: { SiteId: tenant.siteId },
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const services = (response.data as { Services?: MindbodyServiceSummary[] } | undefined)?.Services;
  return Array.isArray(services) ? services : [];
};

export const upsertClient = async (
  tenant: TenantConfig,
  accessToken: string,
  { email, firstName = "Guest", lastName = "Checkout", phone }: { email: string; firstName?: string; lastName?: string; phone?: string }
): Promise<MindbodyClientSummary> => {
  if (!email) {
    throw new Error("email required");
  }

  const client = mbClient(tenant);
  const response = await client.post(
    "/client/clients",
    {
      SiteId: tenant.siteId,
      Clients: [
        {
          FirstName: firstName,
          LastName: lastName,
          Email: email,
          MobilePhone: phone
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const created = (response.data as { Clients?: MindbodyClientSummary[] } | undefined)?.Clients?.[0];

  if (!created?.Id) {
    throw new Error("upsert client failed");
  }

  return created;
};

export const checkoutShoppingCart = async (
  tenant: TenantConfig,
  accessToken: string,
  { clientId, itemId, itemType, amountPaid, notes }: CheckoutShoppingCartInput
): Promise<unknown> => {
  const client = mbClient(tenant);

  const body = {
    SiteId: tenant.siteId,
    ClientId: clientId,
    Items: [
      {
        Item: {
          Id: itemId,
          Type: itemType
        },
        Quantity: 1
      }
    ],
    Payments: [
      {
        Type: "Custom",
        CustomPaymentMethodId: tenant.customTenderId ?? 25,
        Amount: amountPaid
      }
    ],
    InStore: true,
    Test: false,
    SendEmail: true,
    Notes: notes ? notes.slice(0, 255) : undefined
  };

  const response = await client.post("/sale/checkoutshoppingcart", body, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return response.data;
};
