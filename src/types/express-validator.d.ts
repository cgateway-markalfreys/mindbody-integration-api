import type { Request } from "express";

declare module "express-validator" {
  export interface ValidationChain {
    run(req: Request): Promise<void>;
  }

  interface BaseValidationError {
    type: string;
    msg: any;
    value?: unknown;
    location?: string;
    param?: string;
  }

  export interface FieldValidationError extends BaseValidationError {
    path?: string;
  }

  export interface AlternativeValidationError extends BaseValidationError {
    type: "alternative";
    nestedErrors?: ValidationError[];
  }

  export type ValidationError = FieldValidationError | AlternativeValidationError;

  export function validationResult(req: Request): {
    isEmpty(): boolean;
    array(): ValidationError[];
  };

  export function body(field: string): ValidationChain;
  export function query(field: string): ValidationChain;
}
