import type { GmailAttachmentMatch } from "./types";

type GmailMessagePart = {
  filename?: string;
  body?: { attachmentId?: string };
  mimeType?: string;
  parts?: GmailMessagePart[];
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            element: HTMLElement,
            options: Record<string, string | number>,
          ) => void;
        };
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => {
            requestAccessToken: (options?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
const gmailScope = "https://www.googleapis.com/auth/gmail.readonly";

let scriptPromise: Promise<void> | null = null;

function decodeJwtPayload(token: string) {
  const payload = token.split(".")[1];
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(base64);
  return JSON.parse(json) as { email?: string; name?: string };
}

async function ensureGoogleScript() {
  if (window.google?.accounts) return;
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services.")), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google Identity Services."));
      document.head.appendChild(script);
    });
  }
  await scriptPromise;
}

function requireClientId() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("Missing VITE_GOOGLE_CLIENT_ID. Add it to your Vercel/ local env before using Google auth.");
  }
  return clientId;
}

export async function renderGoogleSignInButton(
  element: HTMLElement,
  onCredential: (profile: { name: string; email: string }) => void,
) {
  await ensureGoogleScript();
  const clientId = requireClientId();
  const accounts = window.google?.accounts;

  if (!accounts?.id) {
    throw new Error("Google Sign-In is unavailable.");
  }

  accounts.id.initialize({
    client_id: clientId,
    callback: ({ credential }) => {
      const payload = decodeJwtPayload(credential);
      if (!payload.email || !payload.name) {
        throw new Error("Google account details were not returned.");
      }
      onCredential({ name: payload.name, email: payload.email });
    },
  });

  element.innerHTML = "";
  accounts.id.renderButton(element, {
    type: "standard",
    theme: "filled_black",
    shape: "pill",
    size: "large",
    text: "signup_with",
    width: 280,
  });
}

export async function requestGmailAccess() {
  await ensureGoogleScript();
  const clientId = requireClientId();
  const oauth2 = window.google?.accounts?.oauth2;

  if (!oauth2) {
    throw new Error("Google OAuth is unavailable.");
  }

  return new Promise<string>((resolve, reject) => {
    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: gmailScope,
      callback: ({ access_token, error }) => {
        if (error || !access_token) {
          reject(new Error(error || "Gmail access was not granted."));
          return;
        }
        resolve(access_token);
      },
    });

    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

async function gmailGet<T>(path: string, accessToken: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Gmail API request failed with ${response.status}.`);
  }

  return (await response.json()) as T;
}

function collectPdfParts(
  parts: GmailMessagePart[],
) {
  const matches: Array<{ fileName: string; attachmentId: string }> = [];

  for (const part of parts) {
    const hasPdfName = part.filename?.toLowerCase().endsWith(".pdf");
    const isPdfMime = part.mimeType === "application/pdf";
    if ((hasPdfName || isPdfMime) && part.body?.attachmentId) {
      matches.push({
        fileName: part.filename || "phonepe-statement.pdf",
        attachmentId: part.body.attachmentId,
      });
    }

    if (part.parts?.length) {
      matches.push(...collectPdfParts(part.parts));
    }
  }

  return matches;
}

export async function searchPhonePePdfAttachments(accessToken: string) {
  const query =
    'from:(phonepe OR phonepe.com) filename:pdf has:attachment newer_than:180d';

  const messageList = await gmailGet<{ messages?: Array<{ id: string; threadId: string }> }>(
    `messages?q=${encodeURIComponent(query)}&maxResults=15`,
    accessToken,
  );

  if (!messageList.messages?.length) {
    return [] as GmailAttachmentMatch[];
  }

  const matches: GmailAttachmentMatch[] = [];

  for (const item of messageList.messages) {
    const message = await gmailGet<{
      id: string;
      threadId: string;
      internalDate: string;
      payload?: {
        headers?: Array<{ name: string; value: string }>;
        parts?: GmailMessagePart[];
      };
    }>(`messages/${item.id}?format=full`, accessToken);

    const headers = message.payload?.headers ?? [];
    const subject = headers.find((header) => header.name.toLowerCase() === "subject")?.value ?? "PhonePe mail";
    const from = headers.find((header) => header.name.toLowerCase() === "from")?.value ?? "Unknown sender";
    const parts = collectPdfParts(message.payload?.parts ?? []);

    for (const part of parts) {
      matches.push({
        messageId: message.id,
        threadId: message.threadId,
        internalDate: message.internalDate,
        subject,
        from,
        fileName: part.fileName,
        attachmentId: part.attachmentId,
      });
    }
  }

  return matches.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
}

function base64UrlToUint8Array(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function downloadAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string,
  fileName: string,
) {
  const attachment = await gmailGet<{ data: string }>(
    `messages/${messageId}/attachments/${attachmentId}`,
    accessToken,
  );

  return new File([base64UrlToUint8Array(attachment.data)], fileName, {
    type: "application/pdf",
  });
}
