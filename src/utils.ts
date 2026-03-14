import type { Transaction, TransactionKind } from "./types";

const storageKey = "finance-tracker-transactions";
const importKey = "finance-tracker-imports";

const dateAliases = ["date", "transactiondate", "createdat", "time", "timestamp"];
const amountAliases = ["amount", "transactionamount", "paidamount", "debit", "credit", "value"];
const descriptionAliases = ["description", "details", "merchant", "name", "tofrom", "counterparty", "narration"];
const statusAliases = ["status", "state"];
const typeAliases = ["type", "transactiontype", "flow", "drcr"];
const methodAliases = ["mode", "paymentmode", "method", "instrument"];

const debitHints = ["debit", "paid", "sent", "payment", "withdraw", "purchase"];
const creditHints = ["credit", "received", "refund", "cashback", "deposit"];

export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickValue(row: Record<string, string>, aliases: string[]) {
  const entries = Object.entries(row);
  for (const [key, value] of entries) {
    if (aliases.includes(normalizeHeader(key)) && value?.trim()) {
      return value.trim();
    }
  }
  return "";
}

function parseAmount(row: Record<string, string>) {
  const entries = Object.entries(row);
  let explicitDebit = "";
  let explicitCredit = "";

  for (const [key, value] of entries) {
    const header = normalizeHeader(key);
    if (header === "debit" && value.trim()) explicitDebit = value;
    if (header === "credit" && value.trim()) explicitCredit = value;
  }

  const debitValue = toNumber(explicitDebit);
  const creditValue = toNumber(explicitCredit);

  if (debitValue > 0) return { amount: debitValue, kind: "debit" as TransactionKind };
  if (creditValue > 0) return { amount: creditValue, kind: "credit" as TransactionKind };

  const amountValue = toNumber(pickValue(row, amountAliases));
  const type = inferKind(row);
  return { amount: amountValue, kind: type };
}

function inferKind(row: Record<string, string>): TransactionKind {
  const typeValue = pickValue(row, typeAliases).toLowerCase();
  if (creditHints.some((hint) => typeValue.includes(hint))) return "credit";
  if (debitHints.some((hint) => typeValue.includes(hint))) return "debit";

  const haystack = Object.values(row).join(" ").toLowerCase();
  if (creditHints.some((hint) => haystack.includes(hint))) return "credit";
  return "debit";
}

function toNumber(value: string) {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const numeric = Number.parseFloat(cleaned);
  return Number.isFinite(numeric) ? Math.abs(numeric) : 0;
}

function formatIsoDate(input: string) {
  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  const match = input.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(.*))?$/);
  if (!match) return new Date().toISOString();

  const [, dd, mm, yyyy] = match;
  const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
  const fallback = new Date(`${year}-${mm}-${dd}T00:00:00`);
  return Number.isNaN(fallback.getTime()) ? new Date().toISOString() : fallback.toISOString();
}

function categorize(counterparty: string, method: string, notes: string) {
  const text = `${counterparty} ${method} ${notes}`.toLowerCase();

  if (/swiggy|zomato|restaurant|cafe|starbucks|food/.test(text)) return "Food";
  if (/uber|ola|rapido|metro|petrol|fuel|bus|train|transport/.test(text)) return "Travel";
  if (/amazon|flipkart|myntra|ajio|shopping|store/.test(text)) return "Shopping";
  if (/electricity|water|gas|recharge|bill|broadband|wifi/.test(text)) return "Bills";
  if (/salary|payout|interest/.test(text)) return "Income";
  if (/cashback|reward/.test(text)) return "Rewards";
  if (/rent|landlord|maintenance/.test(text)) return "Home";
  if (/pharmacy|hospital|health|medical/.test(text)) return "Health";
  return "General";
}

export function mapCsvRow(row: Record<string, string>, index: number): Transaction {
  const { amount, kind } = parseAmount(row);
  const counterparty = pickValue(row, descriptionAliases) || "Unknown";
  const method = pickValue(row, methodAliases) || "PhonePe";
  const notes = Object.values(row)
    .filter(Boolean)
    .slice(0, 3)
    .join(" • ");

  return {
    id: `${formatIsoDate(pickValue(row, dateAliases) || new Date().toISOString())}-${amount}-${index}`,
    date: formatIsoDate(pickValue(row, dateAliases) || new Date().toISOString()),
    amount,
    kind,
    counterparty,
    category: categorize(counterparty, method, notes),
    status: pickValue(row, statusAliases) || "Completed",
    method,
    notes,
    raw: row,
  };
}

export function loadTransactions() {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return [] as Transaction[];
  try {
    return JSON.parse(stored) as Transaction[];
  } catch {
    return [];
  }
}

export function saveTransactions(transactions: Transaction[]) {
  localStorage.setItem(storageKey, JSON.stringify(transactions));
}

export function loadImports() {
  const stored = localStorage.getItem(importKey);
  if (!stored) return [] as { fileName: string; importedAt: string; rowCount: number }[];
  try {
    return JSON.parse(stored) as { fileName: string; importedAt: string; rowCount: number }[];
  } catch {
    return [];
  }
}

export function saveImports(imports: { fileName: string; importedAt: string; rowCount: number }[]) {
  localStorage.setItem(importKey, JSON.stringify(imports));
}

export function clearStoredFinanceData() {
  localStorage.removeItem(storageKey);
  localStorage.removeItem(importKey);
}

export function currency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function compactCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

export function monthLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
  }).format(new Date(isoDate));
}

export function dayLabel(isoDate: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
  }).format(new Date(isoDate));
}
