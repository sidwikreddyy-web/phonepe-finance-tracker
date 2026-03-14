import { useEffect, useMemo, useState } from "react";
import type { ImportSummary, Transaction, UserProfile } from "./types";
import {
  clearCurrentUserEmail,
  clearStoredFinanceData,
  compactCurrency,
  currency,
  dayLabel,
  loadImports,
  loadProfile,
  loadTransactions,
  loadUsers,
  monthLabel,
  sanitizeMobileNumber,
  saveImports,
  saveTransactions,
  setCurrentUserEmail,
  upsertUser,
} from "./utils";

type AuthMode = "login" | "signup";
type Insight = {
  title: string;
  value: string;
  tone: "neutral" | "success" | "warning";
};

function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [signupForm, setSignupForm] = useState({ name: "", email: "", mobileNumber: "" });
  const [loginForm, setLoginForm] = useState({ email: "", mobileNumber: "" });
  const [pdfPassword, setPdfPassword] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const storedProfile = loadProfile();
    setProfile(storedProfile);
    if (storedProfile) {
      hydrateUserData(storedProfile);
      setPdfPassword(storedProfile.mobileNumber);
      setSignupForm(storedProfile);
      setLoginForm({ email: storedProfile.email, mobileNumber: storedProfile.mobileNumber });
    }
  }, []);

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
            ? "Upload a PhonePe PDF and unlock it with your mobile number."
            : "Create an account, sign in, then upload your PhonePe statement manually.",
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

  function hydrateUserData(nextProfile: UserProfile) {
    setTransactions(loadTransactions());
    setImports(loadImports());
    setProfile(nextProfile);
  }

  function handleSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = signupForm.name.trim();
    const email = signupForm.email.trim().toLowerCase();
    const mobileNumber = sanitizeMobileNumber(signupForm.mobileNumber);

    if (!name) return setError("Enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address.");
    if (mobileNumber.length !== 10) return setError("Enter a valid 10-digit mobile number.");
    if (loadUsers().some((user) => user.email === email)) {
      return setError("An account with this email already exists. Use the login page.");
    }

    const nextProfile: UserProfile = { name, email, mobileNumber };
    upsertUser(nextProfile);
    hydrateUserData(nextProfile);
    setPdfPassword(mobileNumber);
    setLoginForm({ email, mobileNumber });
    setError("");
    setStatus("Account created. You can upload your PhonePe PDF now.");
  }

  function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = loginForm.email.trim().toLowerCase();
    const mobileNumber = sanitizeMobileNumber(loginForm.mobileNumber);
    const matchedUser = loadUsers().find((user) => user.email === email && user.mobileNumber === mobileNumber);

    if (!matchedUser) {
      return setError("No account matched that email and mobile number.");
    }

    setCurrentUserEmail(matchedUser.email);
    hydrateUserData(matchedUser);
    setPdfPassword(matchedUser.mobileNumber);
    setError("");
    setStatus(`Welcome back, ${matchedUser.name}.`);
  }

  async function ingestPdf(file: File) {
    if (!profile) {
      setError("Sign in first to upload a statement.");
      return;
    }

    const passwordHint = sanitizeMobileNumber(pdfPassword || profile.mobileNumber);
    if (passwordHint.length !== 10) {
      setError("Enter the 10-digit PhonePe statement password before importing.");
      return;
    }

    setError("");
    setStatus(`Parsing ${file.name}...`);

    try {
      const { parsePhonePePdf } = await import("./pdf");
      const { transactions: parsedTransactions } = await parsePhonePePdf(file, passwordHint);

      if (parsedTransactions.length === 0) {
        setStatus("");
        return setError("No transactions were detected in this PDF. Check the statement format and try again.");
      }

      const merged = dedupe([...parsedTransactions, ...loadTransactions()]);
      const updatedImports = [
        { fileName: file.name, importedAt: new Date().toISOString(), rowCount: parsedTransactions.length },
        ...loadImports(),
      ].slice(0, 12);

      setTransactions(merged);
      setImports(updatedImports);
      saveTransactions(merged);
      saveImports(updatedImports);
      setStatus(`Imported ${parsedTransactions.length} transactions from ${file.name}.`);
    } catch (reason) {
      setStatus("");
      setError(reason instanceof Error ? reason.message : "The PhonePe PDF could not be parsed.");
    }
  }

  function handleLogout() {
    clearCurrentUserEmail();
    setProfile(null);
    setTransactions([]);
    setImports([]);
    setPdfPassword("");
    setError("");
    setStatus("Signed out.");
  }

  function handleResetAll() {
    clearStoredFinanceData();
    setProfile(null);
    setTransactions([]);
    setImports([]);
    setPdfPassword("");
    setSignupForm({ name: "", email: "", mobileNumber: "" });
    setLoginForm({ email: "", mobileNumber: "" });
    setError("");
    setStatus("Local accounts and imported data cleared from this device.");
    setAuthMode("signup");
  }

  if (!profile) {
    return (
      <div className="shell auth-shell">
        <div className="backdrop backdrop-left" />
        <div className="backdrop backdrop-right" />
        <section className="auth-hero">
          <div className="auth-copy-block">
            <span className="eyebrow">PhonePe Finance Tracker</span>
            <h1>Sign up once. Upload statements whenever you need.</h1>
            <p>
              This version keeps accounts and analysis local to the device. Users create an account with name, email,
              and mobile number, then unlock PhonePe PDFs with that mobile number.
            </p>
          </div>

          <div className="auth-card">
            <div className="auth-switch">
              <button
                className={authMode === "signup" ? "tab-button active" : "tab-button"}
                onClick={() => {
                  setAuthMode("signup");
                  setError("");
                  setStatus("");
                }}
                type="button"
              >
                Sign Up
              </button>
              <button
                className={authMode === "login" ? "tab-button active" : "tab-button"}
                onClick={() => {
                  setAuthMode("login");
                  setError("");
                  setStatus("");
                }}
                type="button"
              >
                Login
              </button>
            </div>

            {authMode === "signup" ? (
              <form className="auth-form" onSubmit={handleSignup}>
                <label>
                  <span>Full name</span>
                  <input
                    placeholder="Sidwik Reddy"
                    value={signupForm.name}
                    onChange={(event) => setSignupForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Email address</span>
                  <input
                    placeholder="you@example.com"
                    type="email"
                    value={signupForm.email}
                    onChange={(event) => setSignupForm((current) => ({ ...current, email: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Mobile number</span>
                  <input
                    inputMode="numeric"
                    placeholder="10-digit PhonePe mobile"
                    value={signupForm.mobileNumber}
                    onChange={(event) =>
                      setSignupForm((current) => ({ ...current, mobileNumber: event.target.value }))
                    }
                  />
                </label>
                <button className="primary-button" type="submit">
                  Create account
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={handleLogin}>
                <label>
                  <span>Email address</span>
                  <input
                    placeholder="you@example.com"
                    type="email"
                    value={loginForm.email}
                    onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Mobile number</span>
                  <input
                    inputMode="numeric"
                    placeholder="10-digit mobile"
                    value={loginForm.mobileNumber}
                    onChange={(event) =>
                      setLoginForm((current) => ({ ...current, mobileNumber: event.target.value }))
                    }
                  />
                </label>
                <button className="primary-button" type="submit">
                  Login
                </button>
              </form>
            )}

            {error ? <div className="error-banner compact-banner">{error}</div> : null}
            {status ? <div className="status-banner compact-banner">{status}</div> : null}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="backdrop backdrop-left" />
      <div className="backdrop backdrop-right" />

      <header className="hero">
        <div>
          <span className="eyebrow">PhonePe Finance Tracker</span>
          <h1>Manual upload. Fast unlock. Clean analysis.</h1>
          <p>
            Signed in as {profile.name}. Upload the PhonePe PDF, use your mobile number to unlock it, and review
            spending from the same dashboard on desktop or phone.
          </p>
        </div>

        <div className="hero-actions">
          <div className="profile-card">
            <strong>{profile.name}</strong>
            <span>{profile.email}</span>
            <span>PhonePe mobile: {profile.mobileNumber}</span>
            <small>Local account on this device</small>
          </div>
          <div className="button-row">
            <button className="ghost-button" onClick={handleLogout} type="button">
              Sign out
            </button>
            <button className="ghost-button" onClick={handleResetAll} type="button">
              Reset app data
            </button>
          </div>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}
      {status ? <div className="status-banner">{status}</div> : null}

      <section className="action-grid">
        <div className="panel action-panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Unlock</span>
              <h2>Statement password</h2>
            </div>
          </div>
          <p className="auth-copy">
            By default this uses the mobile number from your account. Change it here only if the PhonePe PDF password
            is different.
          </p>
          <label className="auth-form">
            <span>PDF password / mobile number</span>
            <input
              inputMode="numeric"
              placeholder="10-digit mobile"
              value={pdfPassword}
              onChange={(event) => setPdfPassword(event.target.value)}
            />
          </label>
        </div>

        <label className="upload-card panel action-panel">
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void ingestPdf(file);
              event.target.value = "";
            }}
          />
          <span>Upload PhonePe PDF</span>
          <small>Tap here on mobile or desktop to import your password-protected statement.</small>
        </label>
      </section>

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
          <p className="empty-state">Upload a PhonePe PDF to populate the ledger.</p>
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
