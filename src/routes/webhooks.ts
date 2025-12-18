import { isAxiosError } from "axios";
import { Router, type RequestHandler } from "express";
import { get, update } from "../lib/sessions.js";
import { checkoutShoppingCart, getOrCreateClient } from "../services/mbo.js";

type LooseRecord = Record<string, unknown>;

const toRecord = (value: unknown): LooseRecord => (value && typeof value === "object" ? (value as LooseRecord) : {});

const extractRawQuery = (url: string | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }

  const index = url.indexOf("?");
  if (index === -1 || index === url.length - 1) {
    return undefined;
  }

  return url.slice(index + 1);
};

const extractFirstString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = extractFirstString(entry);
      if (match) {
        return match;
      }
    }
  }

  return undefined;
};

const normalizeSessionId = (value: unknown): string | undefined => {
  const raw = extractFirstString(value);
  if (!raw) {
    return undefined;
  }

  const cleaned = raw.replace(/[?#].*$/u, "").replace(/&.*$/u, "");
  return cleaned.length > 0 ? cleaned : undefined;
};

const parseCustomSessionId = (value: unknown): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && typeof (parsed as LooseRecord).sessionId === "string") {
        return ((parsed as LooseRecord).sessionId as string).trim();
      }
    } catch (_err) {
      // Ignore malformed JSON.
    }
  }

  if (typeof value === "object" && value !== null && typeof (value as LooseRecord).sessionId === "string") {
    const id = ((value as LooseRecord).sessionId as string).trim();
    return id.length > 0 ? id : undefined;
  }

  return undefined;
};

export interface CaymanNotificationPayload {
  source?: string;
  query?: LooseRecord;
  body?: LooseRecord;
  rawQuery?: string;
}

export interface CaymanNotificationResult {
  sessionId?: string;
  status: "ignored" | "missing_session" | "no_session" | "failed" | "paid" | "already_paid" | "processing";
  detail?: string;
  receiptId?: string | number | null;
  mindbody?: {
    status: number | null;
    statusText: string | null;
    data: unknown;
  };
}

const successCodes = new Set(["00", "0", "000", "100"]);

const determineSuccess = (payload: LooseRecord): { isSuccess: boolean; resultCode?: string; resultText?: string | undefined } => {
  const resultCodeRaw =
    typeof payload["result-code"] === "string"
      ? payload["result-code"]
      : typeof payload.resultCode === "string"
        ? payload.resultCode
        : undefined;

  const resultRaw =
    typeof payload.result === "string"
      ? payload.result
      : typeof payload.status === "string"
        ? payload.status
        : undefined;

  const successFlag =
    typeof payload.success === "boolean"
      ? payload.success
      : typeof payload.paid === "boolean"
        ? payload.paid
        : undefined;

  const normalizedCode = typeof resultCodeRaw === "string" ? resultCodeRaw.trim() : undefined;
  const loweredResult = typeof resultRaw === "string" ? resultRaw.toLowerCase().trim() : undefined;

  const hasTransactionId = typeof payload["transaction-id"] === "string" || typeof payload.transactionId === "string";

  const isSuccess =
    (typeof normalizedCode === "string" && successCodes.has(normalizedCode)) ||
    (typeof loweredResult === "string" && ["1", "succeeded", "success", "approved"].includes(loweredResult)) ||
    successFlag === true ||
    (hasTransactionId && successFlag !== false && (!normalizedCode || successCodes.has(normalizedCode)));

  return {
    isSuccess,
    resultCode: normalizedCode,
    resultText: loweredResult
  };
};

const extractTransactionId = (payload: LooseRecord): string | undefined => {
  const fromDash = extractFirstString(payload["transaction-id"]);
  if (fromDash) {
    return fromDash;
  }

  const camel = extractFirstString(payload.transactionId);
  if (camel) {
    return camel;
  }

  const vault = extractFirstString(payload["transactionid"]);
  if (vault) {
    return vault;
  }

  const underscore = extractFirstString(payload["txn_id"] ?? payload["txn-id"] ?? payload["txnid"]);
  if (underscore) {
    return underscore;
  }

  const alt = extractFirstString(payload["result-txn-id"] ?? payload["resultTxnId"] ?? payload["reference"]);
  return alt;
};

const extractAuthCode = (payload: LooseRecord): string | undefined =>
  extractFirstString(payload["authorization-code"]) ?? extractFirstString(payload.authorizationCode) ?? extractFirstString(payload.auth);

const extractMaskedPan = (payload: LooseRecord): string | undefined =>
  extractFirstString(payload.maskedPAN) ?? extractFirstString(payload["masked-pan"]);

const sanitizeReference = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.replace(/[^A-Za-z0-9_-]/g, "");
  if (!normalized) {
    return undefined;
  }

  const limited = normalized.slice(0, 30);
  return limited;
};

const parseRawQuery = (raw: string | undefined): LooseRecord => {
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  const cleaned = raw.replace(/^[?#]/u, "").replace(/\?/g, "&");
  const params = new URLSearchParams(cleaned);
  const result: LooseRecord = {};

  for (const [key, value] of params.entries()) {
    if (value !== undefined && value !== null && value !== "") {
      result[key] = value;
    }
  }

  return result;
};

export const processCaymanNotification = async (
  input: CaymanNotificationPayload
): Promise<CaymanNotificationResult> => {
  const source = input.source ?? "webhook";
  const queryPayload = toRecord(input.query);
  const bodyPayload = toRecord(input.body);
  const rawQueryPayload = parseRawQuery(input.rawQuery);
  const payload: LooseRecord = { ...rawQueryPayload, ...queryPayload, ...bodyPayload };

  const sessionId =
    normalizeSessionId(rawQueryPayload.sessionId) ??
    normalizeSessionId(queryPayload.sessionId) ??
    normalizeSessionId(bodyPayload.sessionId) ??
    normalizeSessionId(payload.sessionId) ??
    normalizeSessionId(parseCustomSessionId(payload["customfield-data"])) ??
    normalizeSessionId(parseCustomSessionId(payload.customfield));

  if (!sessionId) {
    console.warn(`[cayman:${source}] Missing sessionId in notification`, {
      query: Object.keys({ ...rawQueryPayload, ...queryPayload }),
      body: Object.keys(bodyPayload)
    });
    return { status: "missing_session", detail: "sessionId not provided" };
  }

  const session = get(sessionId);

  if (!session) {
    console.warn(`[cayman:${source}] Session not found`, { sessionId });
    return { status: "no_session", sessionId, detail: "Session not found" };
  }

  if (session.status === "paid") {
    return { status: "already_paid", sessionId };
  }

  if (session.status === "processing") {
    return { status: "processing", sessionId };
  }

  const { isSuccess, resultCode, resultText } = determineSuccess(payload);

  if (!isSuccess) {
    update(sessionId, { status: "failed" });
    console.warn(`[cayman:${source}] Marked session failed`, { sessionId, resultCode, resultText });
    return { status: "failed", sessionId, detail: "Gateway reported failure" };
  }

  const lockedSession = update(sessionId, { status: "processing" });
  if (!lockedSession) {
    console.warn(`[cayman:${source}] Session disappeared during processing`, { sessionId });
    return { status: "no_session", sessionId, detail: "Session missing during processing" };
  }

  if (lockedSession.status === "paid") {
    return { status: "already_paid", sessionId };
  }

  const customer = lockedSession.customer;
  if (!customer && !lockedSession.clientId) {
    update(sessionId, { status: "failed" });
    console.warn(`[cayman:${source}] Missing customer data`, { sessionId });
    return { status: "failed", sessionId, detail: "Customer data missing" };
  }

  try {
    let resolvedClientId: string | number | undefined = lockedSession.clientId;

    if (!resolvedClientId) {
      if (!customer) {
        update(sessionId, { status: "failed" });
        console.warn(`[cayman:${source}] Missing customer info for client creation`, { sessionId });
        return { status: "failed", sessionId, detail: "Mindbody client missing" };
      }

      const client = await getOrCreateClient(customer.email, customer.firstName, customer.lastName);
      resolvedClientId = client?.Id ?? client?.ID;

      if (!resolvedClientId) {
        update(sessionId, { status: "failed" });
        console.warn(`[cayman:${source}] Mindbody client missing`, { sessionId });
        return { status: "failed", sessionId, detail: "Mindbody client missing" };
      }

      update(sessionId, { clientId: String(resolvedClientId) });
    }

    const resolveMindbodyItemType = (lineType: string | undefined): string => {
      if (typeof lineType === "string") {
        const normalized = lineType.trim().toLowerCase();
        if (normalized === "product") return "Product";
        if (normalized === "package" || normalized === "pricingoption") return "PricingOption";
        if (normalized === "service") return "Service";
      }
      return "Service";
    };

    const items = lockedSession.lines.map((line) => ({
      Type: resolveMindbodyItemType(line.type),
      Item: {
        Id: Number.isFinite(Number(line.productId)) ? Number(line.productId) : line.productId
      },
      Quantity: line.qty,
      Price: line.unitPrice,
      Description: line.name
    }));

    const transactionId = extractTransactionId(payload);
    const authCode = extractAuthCode(payload);
    const maskedPan = extractMaskedPan(payload);
    const last4 = typeof maskedPan === "string" && maskedPan.length >= 4 ? maskedPan.slice(-4) : undefined;

    const notesParts = ["Gateway=Cayman"];
    const sanitizedTxnId = sanitizeReference(transactionId);
    if (sanitizedTxnId) {
      notesParts.push(`TxnId=${sanitizedTxnId}`);
    }
    if (authCode) notesParts.push(`Auth=${authCode}`);
    if (last4) notesParts.push(`Last4=${last4}`);
    if (typeof resultCode === "string" && resultCode.length > 0) notesParts.push(`ResultCode=${resultCode}`);
    if (typeof resultText === "string" && resultText.length > 0) notesParts.push(`Result=${resultText}`);

    const orderId = sanitizeReference(lockedSession.cayman?.orderId);
    if (orderId) {
      notesParts.push(`OrderId=${orderId}`);
    }

    const referenceValue = sanitizedTxnId ?? orderId ?? sanitizeReference(sessionId);

    console.info(`[cayman:${source}] Mindbody checkout reference`, {
      sessionId,
      transactionId: sanitizedTxnId ?? null,
      orderId: orderId ?? null,
      referenceValue
    });

    const isInStore = lockedSession.inStore === true;

    const receipt = await checkoutShoppingCart({
      ClientId: resolvedClientId,
      Items: items,
      Total: lockedSession.total,
      Notes: notesParts.join(" | "),
      inStore: isInStore,
      paymentReference: referenceValue,
      externalReferenceId: referenceValue
    });

    const storedTransactionId = sanitizeReference(transactionId) ?? sanitizeReference(orderId);

    update(sessionId, {
      status: "paid",
      cayman: {
        transactionId: storedTransactionId,
        auth: authCode,
        last4
      }
    });

    const receiptId = (receipt as LooseRecord)?.ReceiptId ?? (receipt as LooseRecord)?.SaleId ?? null;

    console.info(`[cayman:${source}] Session marked paid`, { sessionId, transactionId, receiptId });

    return {
      status: "paid",
      sessionId,
      receiptId: typeof receiptId === "string" || typeof receiptId === "number" ? receiptId : null
    };
  } catch (error) {
    update(sessionId, { status: "failed" });

    if (isAxiosError(error)) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      const data = error.response?.data;

      console.error(`[cayman:${source}] Mindbody fulfillment failed`, {
        sessionId,
        status,
        statusText,
        data
      });

      return {
        status: "failed",
        sessionId,
        detail: `Mindbody checkout failed${status ? ` (status ${status})` : ""}`,
        mindbody: {
          status: status ?? null,
          statusText: statusText ?? null,
          data: data ?? null
        }
      } satisfies CaymanNotificationResult;
    }

    console.error(`[cayman:${source}] Mindbody fulfillment failed`, error);
    return {
      status: "failed",
      sessionId,
      detail: error instanceof Error ? error.message : "Mindbody fulfillment failed"
    };
  }
};

const handleCaymanNotification: RequestHandler = async (req, res) => {
  const result = await processCaymanNotification({
    source: req.method === "GET" ? "webhook:get" : "webhook:post",
    query: req.query as LooseRecord,
    body: req.body as LooseRecord,
    rawQuery: extractRawQuery(req.originalUrl)
  });

  res.json({ received: true, ...result });
};

export const webhookRouter = Router();

webhookRouter.all("/cayman", handleCaymanNotification);
