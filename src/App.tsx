import Papa, { type ParseResult } from "papaparse";
import { useEffect, useMemo, useState } from "react";
import type { ImportSummary, Transaction } from "./types";
import {
  clearStoredFinanceData,
  compactCurrency,
  currency,
  dayLabel,
  loadImports,
  loadTransactions,
  mapCsvRow,
  monthLabel,
  saveImports,
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
  const [error, setError] = useState("");

  useEffect(() => {
    setTransactions(loadTransactions());
    setImports(loadImports());
  }, []);

  const metrics = useMemo(() => {
    const totalSpend = transactions
      .filter((item) => item.kind === "debit")
      .reduce((sum, item) => sum + item.amount, 0);
    const totalIncome = transactions
      .filter((item) => item.kind === "credit")
      .reduce((sum, item) => sum + item.amount, 0);
    const net = totalIncome - totalSpend;
    const avgSpend =
      transactions.filter((item) => item.kind === "debit").length > 0
        ? totalSpend / transactions.filter((item) => item.kind === "debit").length
        : 0;

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
        .slice(0, 7),
    [transactions],
  );

  const insights = useMemo<Insight[]>(() => {
    if (transactions.length === 0) {
      return [
        { title: "Ready to ingest", value: "Import a PhonePe CSV to build your personal trends.", tone: "neutral" },
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
  }, [metrics.avgSpend, topCategories, transactions]);

  function handleImport(file: File) {
    setError("");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result: ParseResult<Record<string, string>>) => {
        const mapped = result.data
          .map((row: Record<string, string>, index: number) => mapCsvRow(row, index))
          .filter((row: Transaction) => row.amount > 0);

        if (mapped.length === 0) {
          setError("No transactions were detected in this CSV. Check the export format and try again.");
          return;
        }

        const existing = loadTransactions();
        const merged = dedupe([...mapped, ...existing]);
        const updatedImports = [
          {
            fileName: file.name,
            importedAt: new Date().toISOString(),
            rowCount: mapped.length,
          },
          ...loadImports(),
        ].slice(0, 8);

        setTransactions(merged);
        setImports(updatedImports);
        saveTransactions(merged);
        saveImports(updatedImports);
      },
      error: () => {
        setError("The CSV could not be parsed. Try exporting it again from PhonePe.");
      },
    });
  }

  function clearAll() {
    clearStoredFinanceData();
    setTransactions([]);
    setImports([]);
    setError("");
  }

  return (
    <div className="shell">
      <div className="backdrop backdrop-left" />
      <div className="backdrop backdrop-right" />

      <header className="hero">
        <div>
          <span className="eyebrow">PhonePe Finance Tracker</span>
          <h1>One clean dashboard for every export you pull each day.</h1>
          <p>
            Upload CSV files, keep a running ledger in the browser, and surface spending trends without touching a spreadsheet.
          </p>
        </div>

        <div className="hero-actions">
          <label className="upload-card">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleImport(file);
                event.target.value = "";
              }}
            />
            <span>Import CSV</span>
            <small>Append today&apos;s export in one click</small>
          </label>

          <button className="ghost-button" onClick={clearAll} type="button">
            Reset local data
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

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
              <h2>Recent CSV ingests</h2>
            </div>
          </div>
          <div className="import-list">
            {imports.length === 0 ? (
              <p className="empty-state">No CSV imported yet.</p>
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
          <p className="empty-state">Import a CSV to populate the ledger.</p>
        ) : (
          <div className="transaction-table">
            {recentTransactions.map((item) => (
              <article className="transaction-row" key={item.id}>
                <div>
                  <strong>{item.counterparty}</strong>
                  <span>{dayLabel(item.date)} • {item.category} • {item.method}</span>
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
