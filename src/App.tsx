import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadAttachment,
  renderGoogleSignInButton,
  requestGmailAccess,
  searchPhonePePdfAttachments,
} from "./google";
import type { GmailAttachmentMatch, ImportSummary, Transaction, UserProfile } from "./types";
import {
  clearStoredFinanceData,
  compactCurrency,
  currency,
  dayLabel,
  loadImports,
  loadProfile,
  loadTransactions,
  monthLabel,
  sanitizeMobileNumber,
  saveImports,
  saveProfile,
  saveTransactions,
} from "./utils";

type Insight = {
  title: string;
  value: string;
  tone: "neutral" | "success" | "warning";
};

function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [draft, setDraft] = useState({ name: "", email: "", mobileNumber: "" });
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [gmailToken, setGmailToken] = useState("");
  const [gmailFiles, setGmailFiles] = useState<GmailAttachmentMatch[]>([]);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTransactions(loadTransactions());
    setImports(loadImports());
    const storedProfile = loadProfile();
    setProfile(storedProfile);
    if (storedProfile) {
      setDraft(storedProfile);
    }
  }, []);

  useEffect(() => {
    if (profile || !googleButtonRef.current) return;

    renderGoogleSignInButton(googleButtonRef.current, ({ name, email }) => {
      setDraft((current) => ({
        ...current,
        name: current.name || name,
        email,
      }));
      setStatus("Google account verified. Complete your name and mobile number to create the account.");
      setError("");
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Google Sign-In could not be loaded.");
    });
  }, [profile]);

  const metrics = useMemo(() => {
    const debits = transactions.filter((item) => item.kind === "debit");
    const credits = transactions.filter((item) => item.kind === "credit");
    const totalSpend = debits.reduce((sum, item) => sum + item.amount, 0);
    const totalIncome = credits.reduce((sum, item) => sum + item.amount, 0);
    const net = totalIncome - totalSpend;
    const avgSpend = debits.length > 0 ? totalSpend / debits.length : 0;
    return { totalSpend, totalIncome, net, avgSpend };
  }, [transactions]);

  const monthlySeries = useMemo(() => {
    const byMonth = new Map<string, { label: string; spend: number; income: number }>();

    for (const item of transactions) {
      const key = item.date.slice(0, 7);
      const current = byMonth.get(key) ?? { label: monthLabel(item.date), spend: 0, income: 0 };
      if (item.kind === "debit") current.spend += item.amount;
      else current.income += item.amount;
      byMonth.set(key, current);
    }

    return Array.from(byMonth.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, values]) => values);
  }, [transactions]);

  const topCategories = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const item of transactions.filter((entry) => entry.kind === "debit")) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.amount);
    }

    return Array.from(byCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [transactions]);

  const recentTransactions = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 8),
    [transactions],
  );

  const insights = useMemo<Insight[]>(() => {
    if (transactions.length === 0) {
      return [
        {
          title: "Ready to ingest",
          value: profile
            ? "Connect Gmail or upload a PhonePe PDF. Your mobile number is used as the statement password."
            : "Create an account and connect Gmail to auto-pull PhonePe statements.",
          tone: "neutral",
        },
      ];
    }

    const biggestSpend = [...transactions]
      .filter((item) => item.kind === "debit")
      .sort((a, b) => b.amount - a.amount)[0];
    const mostUsedCategory = topCategories[0];
    const last7Days = transactions.filter((item) => {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return new Date(item.date).getTime() >= sevenDaysAgo && item.kind === "debit";
    });
    const last7Total = last7Days.reduce((sum, item) => sum + item.amount, 0);

    return [
      {
        title: "Biggest outflow",
        value: biggestSpend ? `${currency(biggestSpend.amount)} to ${biggestSpend.counterparty}` : "No spend data yet",
        tone: "warning",
      },
      {
        title: "Top category",
        value: mostUsedCategory ? `${mostUsedCategory[0]} leads at ${currency(mostUsedCategory[1])}` : "No category pattern yet",
        tone: "neutral",
      },
      {
        title: "Last 7 days",
        value: `${currency(last7Total)} spent across ${last7Days.length} payments`,
        tone: last7Total > metrics.avgSpend * 8 ? "warning" : "success",
      },
    ];
  }, [metrics.avgSpend, profile, topCategories, transactions]);

  async function ingestPdf(file: File, source: string) {
    if (!profile) {
      setError("Create an account first so the app can use your mobile number as the PDF password.");
      return;
    }

    setError("");
    setStatus(`Parsing ${file.name}...`);

    try {
      const { parsePhonePePdf } = await import("./pdf");
      const { transactions: parsedTransactions } = await parsePhonePePdf(file, profile.mobileNumber);

      if (parsedTransactions.length === 0) {
        setError("No transactions were detected in this PDF. Check the PhonePe statement format and try again.");
        setStatus("");
        return;
      }

      const merged = dedupe([...parsedTransactions, ...loadTransactions()]);
      const updatedImports = [
        {
          fileName: source,
          importedAt: new Date().toISOString(),
          rowCount: parsedTransactions.length,
        },
        ...loadImports(),
      ].slice(0, 12);

      setTransactions(merged);
      setImports(updatedImports);
      saveTransactions(merged);
      saveImports(updatedImports);
      setStatus(`Imported ${parsedTransactions.length} transactions from ${source}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The PhonePe PDF could not be parsed.");
      setStatus("");
    }
  }

  function handleCreateAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mobileNumber = sanitizeMobileNumber(draft.mobileNumber);

    if (!draft.name.trim()) {
      setError("Enter your name.");
      return;
    }

    if (!draft.email.trim().endsWith("@gmail.com")) {
      setError("Use a Gmail address so inbox sync can work.");
      return;
    }

    if (mobileNumber.length !== 10) {
      setError("Enter the 10-digit mobile number used as your PhonePe PDF password.");
      return;
    }

    const nextProfile: UserProfile = {
      name: draft.name.trim(),
      email: draft.email.trim().toLowerCase(),
      mobileNumber,
      gmailConnectedAt: profile?.gmailConnectedAt,
    };

    saveProfile(nextProfile);
    setProfile(nextProfile);
    setDraft(nextProfile);
    setError("");
    setStatus("Account created locally on this device. Connect Gmail to start pulling PhonePe statements.");
  }

  async function handleGmailConnect() {
    if (!profile) {
      setError("Create an account first.");
      return;
    }

    setError("");
    setStatus("Requesting Gmail access...");

    try {
      const token = await requestGmailAccess();
      setGmailToken(token);
      const files = await searchPhonePePdfAttachments(token);
      setGmailFiles(files);

      const updatedProfile = {
        ...profile,
        gmailConnectedAt: new Date().toISOString(),
      };
      setProfile(updatedProfile);
      saveProfile(updatedProfile);

      setStatus(files.length ? `Found ${files.length} PhonePe PDF attachments in Gmail.` : "Gmail connected. No PhonePe PDFs found yet.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Gmail connection failed.");
      setStatus("");
    }
  }

  async function handleAttachmentImport(item: GmailAttachmentMatch) {
    if (!gmailToken) {
      setError("Reconnect Gmail before importing from inbox.");
      return;
    }

    setError("");
    setStatus(`Downloading ${item.fileName} from Gmail...`);

    try {
      const file = await downloadAttachment(gmailToken, item.messageId, item.attachmentId, item.fileName);
      await ingestPdf(file, `${item.fileName} via Gmail`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The PhonePe PDF could not be downloaded from Gmail.");
      setStatus("");
    }
  }

  function clearAll() {
    clearStoredFinanceData();
    setTransactions([]);
    setImports([]);
    setProfile(null);
    setDraft({ name: "", email: "", mobileNumber: "" });
    setGmailFiles([]);
    setGmailToken("");
    setError("");
    setStatus("");
  }

  return (
    <div className="shell">
      <div className="backdrop backdrop-left" />
      <div className="backdrop backdrop-right" />

      <header className="hero">
        <div>
          <span className="eyebrow">PhonePe Finance Tracker</span>
          <h1>Inbox-connected money tracking that works on your phone.</h1>
          <p>
            Create an account, connect Gmail, pull only PhonePe statement mails, unlock PDFs with your stored mobile
            number, and keep the dashboard current without manual sorting.
          </p>
        </div>

        <div className="hero-actions">
          {profile ? (
            <div className="profile-card">
              <strong>{profile.name}</strong>
              <span>{profile.email}</span>
              <span>PhonePe mobile: {profile.mobileNumber}</span>
              <small>{profile.gmailConnectedAt ? "Gmail connected" : "Gmail not connected yet"}</small>
            </div>
          ) : (
            <div className="profile-card muted">
              <strong>Account required</strong>
              <span>Use Google to verify Gmail, then save your PhonePe mobile number.</span>
            </div>
          )}

          <button className="ghost-button" onClick={clearAll} type="button">
            Reset local workspace
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}
      {status ? <div className="status-banner">{status}</div> : null}

      {!profile ? (
        <section className="auth-grid">
          <div className="panel auth-panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Step 1</span>
                <h2>Create account</h2>
              </div>
            </div>
            <form className="auth-form" onSubmit={handleCreateAccount}>
              <label>
                <span>Full name</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Sidwik Reddy"
                />
              </label>
              <label>
                <span>Gmail address</span>
                <input
                  value={draft.email}
                  onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                  placeholder="you@gmail.com"
                  type="email"
                />
              </label>
              <label>
                <span>PhonePe mobile number</span>
                <input
                  inputMode="numeric"
                  value={draft.mobileNumber}
                  onChange={(event) => setDraft((current) => ({ ...current, mobileNumber: event.target.value }))}
                  placeholder="10-digit mobile"
                />
              </label>
              <button className="primary-button" type="submit">
                Save account
              </button>
            </form>
          </div>

          <div className="panel auth-panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Step 2</span>
                <h2>Verify Gmail</h2>
              </div>
            </div>
            <p className="auth-copy">
              The app uses Google Sign-In to confirm the Gmail account and later asks separately for read-only Gmail
              access. It only searches for PhonePe emails with PDF attachments.
            </p>
            <div className="google-button-slot" ref={googleButtonRef} />
            <small className="fine-print">Requires `VITE_GOOGLE_CLIENT_ID` in the deployment environment.</small>
          </div>
        </section>
      ) : (
        <section className="action-grid">
          <div className="panel action-panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Sync</span>
                <h2>Gmail import</h2>
              </div>
            </div>
            <p className="auth-copy">
              Connect Gmail with read-only access, list recent PhonePe PDF mails, and import any statement directly on
              desktop or mobile.
            </p>
            <button className="primary-button" onClick={handleGmailConnect} type="button">
              Connect Gmail
            </button>
          </div>

          <label className="upload-card panel action-panel">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void ingestPdf(file, file.name);
                event.target.value = "";
              }}
            />
            <span>Manual PDF import</span>
            <small>Fallback when you already downloaded the statement.</small>
          </label>
        </section>
      )}

      {profile ? (
        <section className="panel inbox-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Inbox</span>
              <h2>PhonePe emails</h2>
            </div>
            <span className="pill">{gmailFiles.length} files</span>
          </div>

          {gmailFiles.length === 0 ? (
            <p className="empty-state">Connect Gmail to search for PhonePe PDF statements from your inbox.</p>
          ) : (
            <div className="mail-list">
              {gmailFiles.map((item) => (
                <article className="mail-row" key={`${item.messageId}-${item.attachmentId}`}>
                  <div>
                    <strong>{item.fileName}</strong>
                    <span>{item.subject}</span>
                    <small>
                      {new Date(Number(item.internalDate)).toLocaleString("en-IN")} • {item.from}
                    </small>
                  </div>
                  <button className="ghost-button compact" onClick={() => void handleAttachmentImport(item)} type="button">
                    Import
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="stats-grid">
        <MetricCard label="Total spend" value={currency(metrics.totalSpend)} detail="All debits imported so far" tone="warning" />
        <MetricCard label="Total income" value={currency(metrics.totalIncome)} detail="Credits, refunds, payouts" tone="success" />
        <MetricCard label="Net cashflow" value={currency(metrics.net)} detail="Income minus spend" tone={metrics.net >= 0 ? "success" : "warning"} />
        <MetricCard label="Avg payment" value={currency(metrics.avgSpend)} detail="Average debit ticket size" tone="neutral" />
      </section>

      <section className="content-grid">
        <div className="panel panel-chart">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Cashflow curve</span>
              <h2>Income vs spending</h2>
            </div>
            <span className="pill">{monthlySeries.length} months</span>
          </div>
          <MonthlyChart data={monthlySeries} />
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Category mix</span>
              <h2>Where money goes</h2>
            </div>
          </div>
          <CategoryBars categories={topCategories} />
        </div>
      </section>

      <section className="content-grid secondary">
        <div className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Smart readout</span>
              <h2>What stands out</h2>
            </div>
          </div>
          <div className="insight-list">
            {insights.map((insight) => (
              <article className={`insight ${insight.tone}`} key={insight.title}>
                <strong>{insight.title}</strong>
                <p>{insight.value}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Import history</span>
              <h2>Recent imports</h2>
            </div>
          </div>
          <div className="import-list">
            {imports.length === 0 ? (
              <p className="empty-state">No statement imported yet.</p>
            ) : (
              imports.map((entry) => (
                <article className="import-row" key={`${entry.fileName}-${entry.importedAt}`}>
                  <div>
                    <strong>{entry.fileName}</strong>
                    <span>{new Date(entry.importedAt).toLocaleString("en-IN")}</span>
                  </div>
                  <span>{entry.rowCount} rows</span>
                </article>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel ledger-panel">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">Ledger</span>
            <h2>Recent transactions</h2>
          </div>
          <span className="pill">{transactions.length} total</span>
        </div>

        {recentTransactions.length === 0 ? (
          <p className="empty-state">Connect Gmail or import a PhonePe PDF to populate the ledger.</p>
        ) : (
          <div className="transaction-table">
            {recentTransactions.map((item) => (
              <article className="transaction-row" key={item.id}>
                <div>
                  <strong>{item.counterparty}</strong>
                  <span>
                    {dayLabel(item.date)} • {item.category} • {item.method}
                  </span>
                </div>
                <div className="transaction-meta">
                  <strong className={item.kind === "credit" ? "positive" : "negative"}>
                    {item.kind === "credit" ? "+" : "-"}
                    {currency(item.amount)}
                  </strong>
                  <span>{item.status}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "success" | "warning";
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function MonthlyChart({
  data,
}: {
  data: { label: string; spend: number; income: number }[];
}) {
  if (data.length === 0) {
    return <p className="empty-state">Monthly trends will show up after your first import.</p>;
  }

  const maxValue = Math.max(...data.flatMap((item) => [item.spend, item.income]), 1);

  return (
    <div className="chart-columns">
      {data.map((item) => (
        <div className="chart-column" key={item.label}>
          <div className="chart-bars">
            <div className="bar-stack">
              <div className="bar income" style={{ height: `${(item.income / maxValue) * 180}px` }} />
              <div className="bar spend" style={{ height: `${(item.spend / maxValue) * 180}px` }} />
            </div>
          </div>
          <strong>{item.label}</strong>
          <span>{compactCurrency(item.spend)}</span>
        </div>
      ))}
    </div>
  );
}

function CategoryBars({
  categories,
}: {
  categories: [string, number][];
}) {
  if (categories.length === 0) {
    return <p className="empty-state">Category analysis appears once debit transactions are imported.</p>;
  }

  const topValue = categories[0][1];

  return (
    <div className="category-list">
      {categories.map(([name, value]) => (
        <div className="category-row" key={name}>
          <div className="category-copy">
            <strong>{name}</strong>
            <span>{currency(value)}</span>
          </div>
          <div className="category-track">
            <div className="category-fill" style={{ width: `${(value / topValue) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
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

export default App;
