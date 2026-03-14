import type { ImportSummary, Transaction, TransactionKind, UserProfile } from "./types";

const storageKey = "finance-tracker-transactions";
const importKey = "finance-tracker-imports";
const profileKey = "finance-tracker-profile";

const debitHints = ["debit", "paid", "sent", "payment", "withdraw", "purchase"];
const creditHints = ["credit", "received", "refund", "cashback", "deposit", "reversal"];

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

function toNumber(value: string) {
  const cleaned = value.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}\b)/g, "");
  const numeric = Number.parseFloat(cleaned);
  return Number.isFinite(numeric) ? Math.abs(numeric) : 0;
}

function inferKind(text: string): TransactionKind {
  const normalized = text.toLowerCase();
  if (creditHints.some((hint) => normalized.includes(hint))) return "credit";
  if (debitHints.some((hint) => normalized.includes(hint))) return "debit";
  return "debit";
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

function normalizeCounterparty(text: string) {
  return text
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, " ")
    .replace(/\b(?:rs|inr|txn|utr|ref|transaction|amount|debited|credited)\b[:.\s-]*/gi, " ")
    .replace(/₹\s?[0-9,]+(?:\.\d{1,2})?/g, " ")
    .replace(/\b(?:success|successful|completed|failed|pending|credited|debited|paid|received|sent)\b/gi, " ")
    .replace(/\b[a-z0-9]{10,}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapPdfBlock(block: string, index: number): Transaction | null {
  const dateMatch = block.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/);
  const amounts = Array.from(block.matchAll(/(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi))
    .map((match) => toNumber(match[1]))
    .filter((amount) => amount > 0);

  if (!dateMatch || amounts.length === 0) {
    return null;
  }

  const amount = amounts[amounts.length - 1];
  const kind = inferKind(block);
  const statusMatch = block.match(/\b(success|successful|completed|failed|pending)\b/i);
  const counterparty = normalizeCounterparty(block).slice(0, 80) || "Unknown";
  const method = /upi/i.test(block) ? "UPI" : /wallet/i.test(block) ? "Wallet" : "PhonePe PDF";

  return {
    id: `${formatIsoDate(dateMatch[0])}-${amount}-${index}`,
    date: formatIsoDate(dateMatch[0]),
    amount,
    kind,
    counterparty,
    category: categorize(counterparty, method, block),
    status: statusMatch ? statusMatch[1][0].toUpperCase() + statusMatch[1].slice(1).toLowerCase() : "Completed",
    method,
    notes: block.slice(0, 220),
    raw: { source: block },
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
  if (!stored) return [] as ImportSummary[];
  try {
    return JSON.parse(stored) as ImportSummary[];
  } catch {
    return [];
  }
}

export function saveImports(imports: ImportSummary[]) {
  localStorage.setItem(importKey, JSON.stringify(imports));
}

export function loadProfile() {
  const stored = localStorage.getItem(profileKey);
  if (!stored) return null as UserProfile | null;
  try {
    return JSON.parse(stored) as UserProfile;
  } catch {
    return null;
  }
}

export function saveProfile(profile: UserProfile) {
  localStorage.setItem(profileKey, JSON.stringify(profile));
}

export function clearStoredFinanceData() {
  localStorage.removeItem(storageKey);
  localStorage.removeItem(importKey);
  localStorage.removeItem(profileKey);
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

export function sanitizeMobileNumber(value: string) {
  return value.replace(/\D/g, "").slice(-10);
}
