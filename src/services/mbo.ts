import { mbo } from "./http.js";

export interface MindbodyServiceItem {
  Id?: number | string;
  id?: number | string;
  Name?: string;
  name?: string;
  Price?: number | string;
  price?: number | string;
  OnlinePrice?: number | string;
  IsHidden?: boolean;
  HideDisplay?: boolean;
}

export interface MindbodyProductItem {
  Id?: number | string;
  id?: number | string;
  Name?: string;
  name?: string;
  Price?: number | string;
  price?: number | string;
  OnlinePrice?: number | string;
  Sku?: string;
  SKU?: string;
  imageUrl?: string;
  ImageUrl?: string;
  IsOnline?: boolean;
  HideDisplay?: boolean;
}

export interface MindbodyPackageItem {
  Id?: number | string;
  id?: number | string;
  Name?: string;
  name?: string;
  Price?: number | string;
  price?: number | string;
  OnlinePrice?: number | string;
  ProgramId?: number | string;
  ProgramIds?: Array<number | string>;
  Count?: number;
  HideDisplay?: boolean;
  IsOnline?: boolean;
}

export interface MindbodyClientSummary {
  Id?: number | string;
  ID?: number | string;
  Email?: string;
  FirstName?: string;
  LastName?: string;
}

export interface CheckoutShoppingCartItem {
  Type?: string;
  Item: {
    Id?: number | string;
  };
  Quantity?: number;
  Price?: number;
  Description?: string;
}

export interface CheckoutShoppingCartPayload {
  ClientId: number | string;
  Items: CheckoutShoppingCartItem[];
  Total?: number;
  Notes?: string;
  inStore?: boolean;
  paymentReference?: string;
  externalReferenceId?: string;
}

const booleanFromEnv = (value: string | undefined): boolean =>
  (value ?? "false").toLowerCase() === "true";

export const listServices = async (): Promise<MindbodyServiceItem[]> => {
  const response = await mbo.get("/sale/services");
  const services = (response.data?.Services ?? response.data?.services) as MindbodyServiceItem[] | undefined;
  return Array.isArray(services) ? services : [];
};

export const listProducts = async (): Promise<MindbodyProductItem[]> => {
  const response = await mbo.get("/sale/products");
  const products = (response.data?.Products ?? response.data?.products) as MindbodyProductItem[] | undefined;
  return Array.isArray(products) ? products : [];
};

export const listPackages = async (): Promise<MindbodyPackageItem[]> => {
  const response = await mbo.get("/sale/packages");
  const packages = (response.data?.Packages ?? response.data?.packages) as MindbodyPackageItem[] | undefined;
  return Array.isArray(packages) ? packages : [];
};

export const getServiceById = async (id: string | undefined): Promise<MindbodyServiceItem | undefined> => {
  const trimmedId = typeof id === "string" ? id.trim() : undefined;

  if (!trimmedId) {
    return undefined;
  }

  const services = await listServices();

  return services.find((service) => String(service.Id ?? service.id) === trimmedId);
};

export const findClientByEmail = async (email: string): Promise<MindbodyClientSummary | undefined> => {
  if (!email) {
    return undefined;
  }

  const response = await mbo.get("/client/clients", {
    params: {
      SearchText: email
    }
  });

  const clients = (response.data?.Clients ?? response.data?.clients) as MindbodyClientSummary[] | undefined;
  if (!Array.isArray(clients)) {
    return undefined;
  }

  return clients.find((client) => (client.Email ?? "").toLowerCase() === email.toLowerCase()) ?? clients[0];
};

export const addClient = async (
  input: Pick<MindbodyClientSummary, "Email" | "FirstName" | "LastName">
): Promise<MindbodyClientSummary | undefined> => {
  const response = await mbo.post("/client/addclient", {
    Client: {
      Email: input.Email,
      FirstName: input.FirstName,
      LastName: input.LastName
    }
  });

  return (response.data?.Client ?? response.data?.Clients?.[0]) as MindbodyClientSummary | undefined;
};

export const getOrCreateClient = async (
  email: string,
  firstName: string,
  lastName: string
): Promise<MindbodyClientSummary | undefined> => {
  const existing = await findClientByEmail(email);
  if (existing?.Id) {
    return existing;
  }

  return addClient({ Email: email, FirstName: firstName, LastName: lastName });
};

export const checkoutShoppingCart = async (
  payload: CheckoutShoppingCartPayload
): Promise<unknown> => {
  const paymentMethodId = Number.parseInt(process.env.MINDBODY_CAYMAN_PAYMENT_METHOD_ID ?? "", 10);
  if (!Number.isFinite(paymentMethodId)) {
    throw new Error("MINDBODY_CAYMAN_PAYMENT_METHOD_ID is required");
  }

  const testMode = booleanFromEnv(process.env.MBO_CHECKOUT_TEST);

  const resolvedAmount = Number.isFinite(payload.Total)
    ? Number(payload.Total)
    : payload.Items.reduce((acc, item) => {
        const quantity = Number.isFinite(Number(item.Quantity)) && Number(item.Quantity) > 0 ? Number(item.Quantity) : 1;
        const price = Number.isFinite(Number(item.Price)) ? Number(item.Price) : 0;
        return acc + price * quantity;
      }, 0);

  const amount = Number.isFinite(resolvedAmount) ? Number.parseFloat(resolvedAmount.toFixed(2)) : NaN;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid Mindbody checkout amount");
  }

  const mindbodyItems = payload.Items.map((item) => {
    const rawItem = typeof item.Item === "object" && item.Item !== null ? (item.Item as { Id?: number | string }) : {};
    const itemId = rawItem?.Id ?? (item.Item as unknown);
    const resolvedItemId =
      typeof itemId === "number" && Number.isFinite(itemId)
        ? itemId
        : typeof itemId === "string" && itemId.trim().length > 0
          ? itemId.trim()
          : undefined;

    const quantity = Number.isFinite(Number(item.Quantity)) && Number(item.Quantity) > 0 ? Number(item.Quantity) : 1;
    const price = Number.isFinite(Number(item.Price)) ? Number(item.Price) : undefined;

    const itemType = typeof item.Type === "string" && item.Type.trim().length > 0 ? item.Type.trim() : "Service";

    const metadataId = resolvedItemId !== undefined ? String(resolvedItemId) : undefined;

    const description = typeof item.Description === "string" && item.Description.trim().length > 0 ? item.Description.trim() : undefined;

    return {
      Item: {
        Type: itemType,
        ...(resolvedItemId !== undefined ? { Id: resolvedItemId } : {}),
        ...(metadataId ? { Metadata: { id: metadataId } } : {})
      },
      Quantity: quantity,
      ...(price !== undefined ? { Amount: price, Price: price } : {}),
      ...(description ? { Description: description } : {})
    };
  });

  const paymentMetadata: Record<string, string> = {
    amount: amount.toFixed(2),
    id: String(paymentMethodId)
  };

  const paymentNote = typeof payload.Notes === "string" && payload.Notes.trim().length > 0 ? payload.Notes.trim() : undefined;
  const paymentReference =
    typeof payload.paymentReference === "string" && payload.paymentReference.trim().length > 0
      ? payload.paymentReference.trim()
      : undefined;
  const externalReferenceId =
    typeof payload.externalReferenceId === "string" && payload.externalReferenceId.trim().length > 0
      ? payload.externalReferenceId.trim()
      : undefined;

  const effectiveReference = paymentReference ?? paymentNote;

  const response = await mbo.post("/sale/checkoutshoppingcart", {
    ClientId: payload.ClientId,
    Items: mindbodyItems,
    Payments: [
      {
        Type: "Custom",
        Amount: amount,
        PaymentMethodId: paymentMethodId,
        CustomPaymentMethodId: paymentMethodId,
        Metadata: paymentMetadata,
        ...(paymentNote ? { Note: paymentNote } : {}),
        ...(effectiveReference ? { Reference: effectiveReference } : {})
      }
    ],
    InStore: payload.inStore ?? false,
    Test: testMode,
    SendEmail: true,
    Notes: payload.Notes ? payload.Notes.slice(0, 255) : undefined,
    ...(externalReferenceId ? { ExternalReferenceId: externalReferenceId } : {})
  });

  return response.data;
};
