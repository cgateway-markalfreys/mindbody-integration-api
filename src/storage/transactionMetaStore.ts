export interface TransactionMeta {
  birthDate?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  mindbodyServiceId?: string;
  mindbodyServiceDescription?: string;
  mindbodyClientId?: string;
}

export const transactionMetaStore: Record<string, TransactionMeta> = {};

/**
 * To map a Cayman product to a Mindbody service for a single transaction,
 * populate transactionMetaStore[transactionId] with { mindbodyServiceId, mindbodyServiceDescription }
 * at the point where the Cayman payment link or transaction is created.
 */
