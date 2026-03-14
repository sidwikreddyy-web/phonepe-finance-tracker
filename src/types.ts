export type TransactionKind = "credit" | "debit";

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  kind: TransactionKind;
  counterparty: string;
  category: string;
  status: string;
  method: string;
  notes: string;
  raw: Record<string, string>;
}

export interface ImportSummary {
  fileName: string;
  importedAt: string;
  rowCount: number;
}

export interface UserProfile {
  name: string;
  email: string;
  mobileNumber: string;
}
