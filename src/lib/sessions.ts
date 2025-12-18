export interface SessionCustomer {
  email: string;
  firstName: string;
  lastName: string;
}

export interface SessionLine {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  type?: string;
}

export interface SessionCaymanMetadata {
  orderId?: string;
  transactionId?: string;
  auth?: string;
  last4?: string;
}

export type SessionStatus = "created" | "processing" | "paid" | "failed";

export interface Session {
  id: string;
  siteKey: string;
  customer?: SessionCustomer;
  lines: SessionLine[];
  total: number;
  status: SessionStatus;
  cayman?: SessionCaymanMetadata;
  clientId?: string;
  inStore?: boolean;
}

const store = new Map<string, Session>();

export const save = (session: Session): Session => {
  store.set(session.id, session);
  return session;
};

export const get = (id: string): Session | undefined => store.get(id);

export const update = (id: string, patch: Partial<Session>): Session | undefined => {
  const existing = store.get(id);
  if (!existing) {
    return undefined;
  }

  const updated: Session = {
    ...existing,
    ...patch,
    cayman: {
      ...existing.cayman,
      ...patch.cayman
    }
  };

  store.set(id, updated);
  return updated;
};
