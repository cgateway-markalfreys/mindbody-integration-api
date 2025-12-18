import { cayman } from "./http.js";

export type CaymanOperation = "sale" | "authorize" | "capture" | "void" | "refund";

export interface CaymanThreeStepResponse {
  ok: boolean;
  raw: unknown;
  resultCode?: string;
  txnId?: string;
  authCode?: string;
  last4?: string;
  expMonth?: string;
  expYear?: string;
  masked?: string;
}

const withApiKey = (payload: Record<string, unknown>): Record<string, unknown> => ({
  ...payload,
  "api-key": process.env.CAYMAN_API_KEY ?? ""
});

export const isOk = (code?: string | number, fallbackSuccess?: boolean): boolean => {
  if (typeof code === "string") {
    if (code === "000" || code === "0" || code.startsWith("2")) return true;
  }
  if (typeof code === "number" && code >= 200 && code < 300) return true;
  return Boolean(fallbackSuccess);
};

export const threeStep = async (
  operation: CaymanOperation,
  payload: Record<string, unknown>
): Promise<CaymanThreeStepResponse> => {
  const response = await cayman.post("/three-step", { [operation]: withApiKey(payload) });
  const data = response.data as Record<string, unknown>;
  const resultCode = (data["result-code"] || data.result || data.code) as string | undefined;
  const txnId = (data["transaction-id"] || data.transactionId || data.txnId) as string | undefined;
  const authCode = (data["auth-code"] || data.authCode) as string | undefined;
  const masked = (data["cc-number"] || data.card || data.masked) as string | undefined;

  const last4 = typeof masked === "string" && masked.length >= 4 ? masked.slice(-4) : undefined;
  const expMonth = (data["cc-exp-month"] || data.expMonth) as string | undefined;
  const expYear = (data["cc-exp-year"] || data.expYear) as string | undefined;

  const ok = isOk(resultCode, Boolean(data.success));

  return {
    ok,
    raw: data,
    resultCode,
    txnId,
    authCode,
    last4,
    expMonth,
    expYear,
    masked
  };
};
