import axios, { AxiosInstance } from "axios";
import {
  CaymanAddCustomerRequest,
  CaymanCaptureRequest,
  CaymanCancelSubscriptionRequest,
  CaymanConsumerResponse,
  CaymanRecurringChargeRequest,
  CaymanRefundRequest,
  CaymanReverseRequest,
  CaymanSaleFromVaultRequest,
  CaymanSaleRequest,
  CaymanSubscriptionRequest,
  CaymanTransactionDetailsResponse,
  CaymanTransactionInfoRequest,
  CaymanVoidRequest,
  CaymanAuthOnlyRequest
} from "../types/cayman.js";

export interface CaymanConfig {
  baseUrl: string;
  apiKey: string;
  username: string;
  password: string;
}

export interface CaymanService {
  createAddCustomerSession(request: CaymanAddCustomerRequest): Promise<CaymanConsumerResponse>;
  createSaleSession(request: CaymanSaleRequest): Promise<CaymanConsumerResponse>;
  createSubscriptionSession(request: CaymanSubscriptionRequest): Promise<CaymanConsumerResponse>;
  authorizePayment(request: CaymanAuthOnlyRequest): Promise<CaymanConsumerResponse>;
  chargeSavedCard(request: CaymanSaleFromVaultRequest): Promise<CaymanConsumerResponse>;
  refundTransaction(request: CaymanRefundRequest): Promise<CaymanConsumerResponse>;
  reverseTransaction(request: CaymanReverseRequest): Promise<CaymanConsumerResponse>;
  captureAuthorization(request: CaymanCaptureRequest): Promise<CaymanConsumerResponse>;
  voidAuthorization(request: CaymanVoidRequest): Promise<CaymanConsumerResponse>;
  cancelSubscription(request: CaymanCancelSubscriptionRequest): Promise<CaymanConsumerResponse>;
  triggerRecurringCharge(request: CaymanRecurringChargeRequest): Promise<CaymanConsumerResponse>;
  getTransactionDetails(request: CaymanTransactionInfoRequest): Promise<CaymanTransactionDetailsResponse>;
}

const createAxiosClient = (config: CaymanConfig): AxiosInstance => {
  const basicAuth = Buffer.from(`${config.username}:${config.password}`).toString("base64");

  return axios.create({
    baseURL: config.baseUrl,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${basicAuth}`
    }
  });
};

const withApiKey = (apiKey: string, payload: Record<string, unknown>): Record<string, unknown> => ({
  "api-key": apiKey,
  ...payload
});

const postThreeStep = async <T>(client: AxiosInstance, payload: Record<string, unknown>): Promise<T> => {
  const response = await client.post<T>("/three-step", payload);
  return response.data;
};

export const createCaymanService = (config: CaymanConfig): CaymanService => {
  const client = createAxiosClient(config);

  return {
    createAddCustomerSession: (request) =>
      postThreeStep<CaymanConsumerResponse>(client, {
        "add-customer": withApiKey(config.apiKey, request as Record<string, unknown>)
      }),

    createSaleSession: (request) =>
      postThreeStep<CaymanConsumerResponse>(client, {
        sale: withApiKey(config.apiKey, request as Record<string, unknown>)
      }),

    createSubscriptionSession: (request) =>
      postThreeStep<CaymanConsumerResponse>(client, {
        subscribe: withApiKey(config.apiKey, request as Record<string, unknown>)
      }),

    authorizePayment: (request) =>
      postThreeStep<CaymanConsumerResponse>(client, {
        authonly: withApiKey(config.apiKey, request as Record<string, unknown>)
      }),

    chargeSavedCard: (request) =>
      postThreeStep<CaymanConsumerResponse>(client, {
        sale: withApiKey(config.apiKey, request as Record<string, unknown>)
      }),

    refundTransaction: (request) =>
      postThreeStep<CaymanConsumerResponse>(client, {
        refund: withApiKey(config.apiKey, request as Record<string, unknown>)
      }),

    reverseTransaction: (request) =>
      postThreeStep<CaymanConsumerResponse>(client, {
        reverse: withApiKey(config.apiKey, request as Record<string, unknown>)
      }),

    captureAuthorization: (request) =>
      postThreeStep<CaymanConsumerResponse>(client, {
        capture: withApiKey(config.apiKey, request as Record<string, unknown>)
      }),

    voidAuthorization: (request) =>
      postThreeStep<CaymanConsumerResponse>(client, {
        void: withApiKey(config.apiKey, request as Record<string, unknown>)
      }),

    cancelSubscription: (request) =>
      postThreeStep<CaymanConsumerResponse>(client, {
        "cancel-subscription": withApiKey(config.apiKey, request as Record<string, unknown>)
      }),

    triggerRecurringCharge: async (request) => {
      const response = await client.post<CaymanConsumerResponse>("/recurauth", {
        recurauth: withApiKey(config.apiKey, request as Record<string, unknown>)
      });
      return response.data;
    },

    getTransactionDetails: async (request) => {
      const response = await client.post<CaymanTransactionDetailsResponse>("/transaction-info", {
        ...withApiKey(config.apiKey, request as Record<string, unknown>)
      });
      return response.data;
    }
  };
};
