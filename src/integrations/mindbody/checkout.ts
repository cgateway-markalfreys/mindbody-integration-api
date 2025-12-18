import { AxiosError, AxiosInstance } from "axios";
import { isCheckoutTest } from "../../config/env.js";

export interface CaymanCheckoutParams {
  siteId: number;
  clientId: number;
  serviceId: string;
  servicePrice: number;
  caymanAmount: number;
  txId: string;
  caymanPaymentMethodId: number;
}

/**
 * Build a Mindbody checkout payload that records a Cayman payment as a single Custom payment.
 */
export const buildCaymanCheckoutPayload = (params: CaymanCheckoutParams): Record<string, unknown> => {
  const items = [
    {
      Item: {
        Type: "Service",
        Id: params.serviceId
      },
      Quantity: 1,
      Amount: params.servicePrice,
      Description: `Cayman Gateway payment (TX: ${params.txId})`
    }
  ];

  const paymentMetadata = {
    id: params.caymanPaymentMethodId,
    gateway: "Cayman",
    gatewayTransactionId: params.txId,
    gatewayAmount: params.caymanAmount.toFixed(2),
    amount: params.servicePrice.toFixed(2)
  };

  const payments = [
    {
      Type: "Custom",
      PaymentMethodId: params.caymanPaymentMethodId,
      Amount: params.servicePrice,
      Metadata: paymentMetadata
    }
  ];

  const payload: Record<string, unknown> = {
    ClientId: params.clientId,
    SiteId: params.siteId,
    Test: isCheckoutTest() ? true : false,
    Items: items,
    Payments: payments
  };

  // Mindbody requires the payment total to match the calculated cart total. Record the
  // actual Cayman amount in metadata but keep the payment amount equal to the service
  // price to satisfy checkout validation.
  payments[0].Metadata.amount = params.caymanAmount.toFixed(2);

  return payload;
};

/**
 * Validate that the payload is constrained to the Cayman Custom payment method.
 */
export const validatePayloadForCayman = (payload: any): void => {
  if (!payload?.Payments || !Array.isArray(payload.Payments)) {
    throw new Error("Checkout payload must include Payments array.");
  }

  if (payload.Payments.length !== 1) {
    throw new Error("Checkout payload must include exactly one payment entry.");
  }

  const payment = payload.Payments[0];

  if (payment.Type !== "Custom") {
    throw new Error("Checkout payment must use the Custom payment type for Cayman.");
  }

  if (payment.PaymentMethodId !== 25) {
    throw new Error("Checkout payment must use Cayman Gateway Test payment method (Id 25).");
  }

  if (payment.PaymentInfo !== undefined) {
    throw new Error("Checkout payment must not include PaymentInfo for Cayman Custom payments.");
  }

  if (!payment.Metadata || payment.Metadata.id !== payment.PaymentMethodId) {
    throw new Error("Checkout payment metadata must include matching id for the Cayman payment method.");
  }
};

/**
 * Execute the Mindbody checkout and ensure Mindbody records the Cayman payment method.
 */
export const checkoutCayman = async (http: AxiosInstance, payload: any): Promise<any> => {
  try {
    const response = await http.post("/sale/checkoutshoppingcart", payload);
    const data = response.data as { Payments?: Array<{ PaymentMethod?: { Name?: string } }> };
    const hasCaymanPayment =
      Array.isArray(data.Payments) && data.Payments.some((entry) => entry.PaymentMethod?.Name === "Cayman Gateway Test");

    if (!hasCaymanPayment) {
      throw new Error("Mindbody recorded unexpected payment method.");
    }

    return data;
  } catch (error: any) {
    const axiosError = error as AxiosError;
    const responseData = axiosError.response?.data as any;
    const message = responseData?.Error?.Message ?? responseData?.Message ?? axiosError.message ?? "Unknown error";

    if (axiosError.isAxiosError) {
      axiosError.message = `Mindbody checkout error: ${message}`;
      throw axiosError;
    }

    throw new Error(`Mindbody checkout error: ${message}`);
  }
};
