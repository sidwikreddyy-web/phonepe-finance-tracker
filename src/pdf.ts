import { PasswordResponses, getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Transaction } from "./types";
import { mapPdfBlock } from "./utils";

GlobalWorkerOptions.workerSrc = workerSrc;

type TextItemLike = {
  str: string;
  transform: number[];
};

function groupPageLines(items: TextItemLike[]) {
  const lines = new Map<string, TextItemLike[]>();

  for (const item of items) {
    if (!item.str.trim()) continue;
    const key = Math.round(item.transform[5]).toString();
    const current = lines.get(key) ?? [];
    current.push(item);
    lines.set(key, current);
  }

  return Array.from(lines.entries())
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([, lineItems]) =>
      lineItems
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((item) => item.str.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

function buildTransactionBlocks(lines: string[]) {
  const blocks: string[] = [];
  const datePattern = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/;
  let current = "";

  for (const line of lines) {
    if (datePattern.test(line)) {
      if (current) blocks.push(current.trim());
      current = line;
      continue;
    }

    if (current) {
      current = `${current} ${line}`.trim();
    }
  }

  if (current) blocks.push(current.trim());

  return blocks;
}

function dedupe(items: Transaction[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.date}-${item.amount}-${item.counterparty}-${item.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function passwordCandidates(input: string) {
  const digits = input.replace(/\D/g, "");
  const candidates = [digits];
  if (digits.length > 10) candidates.push(digits.slice(-10));
  return [...new Set(candidates.filter(Boolean))];
}

async function openProtectedDocument(data: Uint8Array, passwordHint: string) {
  const candidates = passwordCandidates(passwordHint);
  let lastError: Error | null = null;

  for (const password of candidates) {
    try {
      const doc = await getDocument({ data, password }).promise;
      return doc;
    } catch (error) {
      lastError = error as Error;
    }
  }

  if (lastError) throw lastError;
  throw new Error("Unable to open PDF.");
}

export async function parsePhonePePdf(file: File, passwordHint: string) {
  const data = new Uint8Array(await file.arrayBuffer());

  let doc;
  try {
    doc = await openProtectedDocument(data, passwordHint);
  } catch (error) {
    const maybePasswordError = error as { code?: number };
    if (
      maybePasswordError.code === PasswordResponses.NEED_PASSWORD ||
      maybePasswordError.code === PasswordResponses.INCORRECT_PASSWORD
    ) {
      throw new Error("The PhonePe PDF password did not match the stored mobile number.");
    }
    throw error;
  }

  const pageLines: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pageLines.push(...groupPageLines(content.items as TextItemLike[]));
  }

  const blocks = buildTransactionBlocks(pageLines);
  const transactions = dedupe(
    blocks
      .map((block, index) => mapPdfBlock(block, index))
      .filter((item): item is Transaction => item !== null && item.amount > 0),
  );

  return { transactions, blocksParsed: blocks.length };
}
