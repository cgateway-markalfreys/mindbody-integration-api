import type { NextFunction, Request, RequestHandler, Response } from "express";
import { validationResult, type ValidationChain } from "express-validator";

export const validate = (chains: ValidationChain[]): RequestHandler =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await Promise.all(chains.map((chain) => chain.run(req)));
    const result = validationResult(req);

    if (result.isEmpty()) {
      next();
      return;
    }

    const errors = (result.array() as Array<Record<string, any>>).map((error) => ({
      field: normalizeField(error),
      message: error.msg
    }));

    res.status(422).json({ errors });
  };

export const badRequest = (res: Response, message: string, details?: unknown): void => {
  res.status(400).json({ error: message, details: details ?? null });
};

export const paymentRequired = (res: Response, message: string, details?: unknown): void => {
  res.status(402).json({ error: message, details: details ?? null });
};

const normalizeField = (error: Record<string, any>): string => {
  if (typeof error.path === "string" && error.path.length > 0) {
    return error.path;
  }

  if (typeof error.param === "string" && error.param.length > 0) {
    return error.param;
  }

  if (Array.isArray(error.nestedErrors) && error.nestedErrors.length > 0) {
    const nested = error.nestedErrors[0] as Record<string, any>;
    if (typeof nested.path === "string" && nested.path.length > 0) {
      return nested.path;
    }
    if (typeof nested.param === "string" && nested.param.length > 0) {
      return nested.param;
    }
  }

  return "unknown";
};
