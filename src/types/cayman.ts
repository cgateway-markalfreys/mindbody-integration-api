export type CaymanCurrency = "USD" | "KYD";

export type CaymanBaseBilling = {
  firstName: string;
  email: string;
  street1: string;
  city: string;
  country: string;
  zip: string;
  lastName?: string;
  phone?: string;
  street2?: string;
  state?: string;
  returnUrl?: string;
  receiptText?: string;
  birthDate?: string;
} & Record<string, unknown>;

export type CaymanAddCustomerRequest = CaymanBaseBilling & {
  notificationUrl: string;
};

export type CaymanSaleRequest = CaymanBaseBilling & {
  notificationUrl: string;
  amount: number;
  currency: CaymanCurrency;
};

export type CaymanSubscriptionRequest = CaymanSaleRequest & {
  frequencyindays: number;
  trialdays?: number;
};

export type CaymanAuthOnlyRequest = CaymanSaleRequest;

export type CaymanSaleFromVaultRequest = {
  "customer-vault-id": string;
  amount: number;
  currency: CaymanCurrency;
} & Record<string, unknown>;

export type CaymanRefundRequest = {
  "transaction-id": string;
  amount: string | number;
} & Record<string, unknown>;

export type CaymanReverseRequest = {
  "transaction-id": string;
} & Record<string, unknown>;

export type CaymanCaptureRequest = {
  "transaction-id": string;
} & Record<string, unknown>;

export type CaymanVoidRequest = {
  "transaction-id": string;
} & Record<string, unknown>;

export type CaymanCancelSubscriptionRequest = {
  subscriptionId: number;
  customerGUID: string;
} & Record<string, unknown>;

export type CaymanRecurringChargeRequest = {
  subscriptionId: number;
  customerGUID: string;
  clientRefId?: string | number;
} & Record<string, unknown>;

export type CaymanTransactionInfoRequest = {
  "transaction-id": string;
} & Record<string, unknown>;

export interface CaymanConsumerResponse {
  result?: string;
  "result-text"?: string;
  "transaction-id"?: string;
  "result-code"?: string;
  "consumer-url"?: string;
  success: boolean;
  [key: string]: unknown;
}

export type CaymanThreeStepOperation =
  | "add-customer"
  | "sale"
  | "subscribe"
  | "authonly"
  | "refund"
  | "reverse"
  | "capture"
  | "void"
  | "cancel-subscription"
  | "recurauth"
  | "transaction-info"
  | "sale-from-vault";

export interface CaymanTransactionDetailsResponse {
  success: boolean;
  transaction?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CaymanWebhookBilling extends Record<string, string | null | undefined> {}

export interface CaymanWebhookNotification {
  email?: string;
  firstName?: string;
  lastName?: string;
  amount?: number | string;
  billing?: CaymanWebhookBilling;
  "result-code"?: string;
  "transaction-id"?: string;
  [key: string]: unknown;
}
