import { http } from "../lib/http.js";
import { env } from "../lib/env.js";

export interface CreatePaymentInput {
  amount: number;
  currency: string;
  description?: string;
  metadata?: Record<string, unknown>;
  returnUrl: string;
  cancelUrl: string;
}

export interface CreatePaymentResponse {
  id?: string;
  checkoutUrl?: string;
  [key: string]: unknown;
}

const caymanClient = http(env.CAYMAN_BASE_URL, {
  Authorization: `Bearer ${env.CAYMAN_API_KEY}`,
  Accept: "application/json",
  "Content-Type": "application/json"
});

export const createPayment = async (payload: CreatePaymentInput): Promise<CreatePaymentResponse> => {
  const response = await caymanClient.post("/payments", payload);
  return response.data as CreatePaymentResponse;
};
