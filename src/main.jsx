import React, { useState, useRef, useEffect, memo } from "react";
import { createRoot } from "react-dom/client";
import {
  day,
  empty,
  iso,
  inactivity,
  history,
  dailyServiceStats,
  historyYears,
  latestBillsByService,
  billingDaysLeft,
  pricePerViewReport,
  monthlySpend,
  amountPaidMinor,
  coveredServices,
  coveredPeriods,
  serviceKey,
  readYaml,
  writeYaml,
  readHistoryInput,
  viewingKey,
  merge,
} from "./ledger.js";
import "./style.css";

const brands = new Map([
  ["netflix", { logo: "netflix", color: "#fa787b" }],
  ["hulu", { logo: "hulu", color: "#80d39f" }],
  ["hbo max", { logo: "max", color: "#a191e5" }],
  ["apple tv+", { logo: "apple-plus", color: "#a7bace" }],
  ["apple tv", { logo: "apple", color: "#a7bace" }],
  ["disney+", { logo: "disney", color: "#79a8ef" }],
  ["espn select", { logo: "espn", color: "#e6bc79" }],
  ["peacock", { logo: "peacock", color: "#fff" }],
  ["crunchyroll", { logo: "crunchyroll", color: "#ff9859" }],
  ["paramount+", { logo: "paramount", color: "#79a8ef" }],
]);
const localDate = new Date();
const today = Date.UTC(
  localDate.getFullYear(),
  localDate.getMonth(),
  localDate.getDate(),
);
const currentYear = localDate.getFullYear();
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const fullDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});
const fmt = (time, year = false) =>
  (year ? fullDateFormat : dateFormat).format(time);
const monthName = (time) => monthFormat.format(time);
function formatCharge(minor, currency) {
  const formatter = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  });
  return formatter.format(
    minor / 10 ** formatter.resolvedOptions().maximumFractionDigits,
  );
}
function brand(name) {
  return brands.get(serviceKey(name)) ?? { color: "#e6bc79" };
}
function Icon({ type }) {
  const paths = {
    import: "M12 15V3m-5 5 5-5 5 5M4 14v6h16v-6",
    export: "M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4",
    calendar: "M3 6h18v15H3zM3 10h18M7 3v6m10-6v6",
    cost: "M3 5h18v14H3zM3 9h18M6 15h4",
    rate: "M4 12h16M11 6h2m-2 12h2",
    timeline: "M3 5h12M8 12h13M3 19h10",
    viewing:
      "M2 12 Q12 -2 22 12 Q12 26 2 12z M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0",
    records: "M4 4h16v16H4zM4 9h16M4 14h16",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[type]} />
    </svg>
  );
}
function Mark({ name }) {
  const { logo } = brand(name);
  return (
    <span className="mark" data-logo={logo} aria-hidden="true">
      {logo
        ? <img src={import.meta.env.BASE_URL + "providers/" + logo + ".svg"} alt="" />
        : <Icon type="viewing" />}
    </span>
  );
}
function ProviderLabel({ name, children }) {
  return (
    <span className="provider-label" style={{ "--ink": brand(name).color }}>
      <Mark name={name} />
      <span>{name}{children}</span>
    </span>
  );
}
function ProviderList({ names }) {
  return <span className="provider-list">
    {names.map(name => <ProviderLabel key={serviceKey(name)} name={name} />)}
  </span>;
}
function Dialog({ title, close, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close}>
      <div className="dialoghead">
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={close}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Import({ close, apply }) {
  const [incoming, setIncoming] = useState(null),
    [error, setError] = useState(""),
    [mode, setMode] = useState("merge");
  const seq = useRef(0);
  const [entry, setEntry] = useState("file");
  async function choose(file) {
    const request = ++seq.current;
    setIncoming(null);
    setError("");
    if (!file) return;
    try {
      const input = /\.pdf$/i.test(file.name)
        ? await file.arrayBuffer()
        : await file.text();
      const next = await readHistoryInput(input, file.name, { monthlyPayPal: entry === "paypal" });
      if (seq.current === request) setIncoming(next);
    } catch (e) {
      if (seq.current === request) setError(e.message);
    }
  }
  return (
    <Dialog title="Import history" close={close}>
      <p>
        For a saved project import, ask Codex to import the file. This dialog
        opens a temporary browser copy.
      </p>
      <label>
        Input format
        <select
          value={entry}
          onChange={(e) => {
            setEntry(e.target.value);
            choose(null);
          }}
        >
          <option value="file">History file</option>
          <option value="payments">
            Paste payment history (USD)
          </option>
          <option value="paypal">Paramount+ monthly via PayPal (USD)</option>
        </select>
      </label>
      {entry === "file" ? (
        <>
          <p>
            Open a Hulu privacy report PDF, NetflixViewingHistory.csv, a Crunchyroll,
            Hulu, Netflix or Peacock payment history .txt, a strmr YAML ledger or a CSV with
            service, start, and end columns. Use the first uncovered day for
            end. Leave it blank for ongoing subscriptions.
          </p>
          <p>
            For charges, use service, date, and cycle (monthly or annual). Each
            charge covers one cycle starting on its date. Leave cycle blank and
            supply amountMinor and currency to find the cycle from a matching
            historical list price.{" "}
            <a href="https://mapsub.com/data/" target="_blank" rel="noreferrer">
              MapSub price history
            </a>
          </p>
          <p>For viewing history, use a CSV with service, date, and title columns.</p>
          <label>
            History file
            <input
              type="file"
              accept=".yml,.yaml,.csv,.txt,.pdf"
              onChange={(e) => choose(e.target.files[0])}
            />
          </label>
        </>
      ) : (
        <label>
          {entry === "paypal" ? "PayPal payments for a confirmed monthly Paramount+ plan" : "Crunchyroll, Hulu, Netflix or Peacock payment history (US dollars)"}
          <textarea
            rows={6}
            key={entry}
            placeholder={entry === "paypal" ? "Paste month and year headings, merchant, amounts and payment dates" : "Paste payment rows, including plan names, dates and totals"}
            onChange={(e) => {
              const text = e.target.value;
              choose(
                text.trim() ? new File([text], "payment-history.txt") : null,
              );
            }}
          />
        </label>
      )}
      <label>
        Import mode
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="replace">Replace displayed history</option>
          <option value="merge">Merge with displayed history</option>
        </select>
      </label>
      {incoming && (
        <p>
          {incoming.periods.length} subscription records ·{" "}
          {incoming.viewing?.length || 0} viewing entries ·{" "}
          {incoming.periods.filter((p) => p.estimate).length} charge-based
          periods
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={!incoming}
        onClick={() => {
          try {
            apply(incoming, mode);
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        Import history
      </button>
    </Dialog>
  );
}
const basisLabel = {
  recorded: "Recorded period",
  cycle: "Billing cycle",
  price: "Price match",
};
function coverageBasis(span, name) {
  if (span.billingCycle.includes(name)) return "cycle";
  return span.estimated.includes(name) ? "price" : "recorded";
}
function IdlePeriods({ ledger, start, end, names, minimum, setMinimum }) {
  const gaps = inactivity(ledger, end, minimum, start);
  const hasViews = new Set(
    (ledger.viewing || []).map((v) => serviceKey(v.service)),
  );
  const missing = names.filter((n) => !hasViews.has(serviceKey(n)));
  return (
    <section className="panel idle-panel">
      <div className="panelhead">
        <div>
          <h2>Inactivity</h2>
          <p>
            Continuous coverage with no recorded views. Gaps in viewing exports
            can extend a streak.
          </p>
        </div>
        <select
          aria-label="Minimum inactive streak"
          value={minimum}
          onChange={(e) => setMinimum(Number(e.target.value))}
        >
          {[30, 60, 90].map((n) => (
            <option key={n} value={n}>
              {n}+ days
            </option>
          ))}
        </select>
      </div>
      {gaps.length ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>First idle day</th>
                <th>Last idle day</th>
                <th>Days</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.name + iso(g.start)}>
                  <td><ProviderLabel name={g.name} /></td>
                  <td>{fmt(g.start, true)}</td>
                  <td>{fmt(g.end - day, true)}</td>
                  <td>{(g.end - g.start) / day}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          No qualifying streaks in the available history for this year.
        </p>
      )}
      {missing.length > 0 && (
        <div className="missing-viewing">
          <p>No viewing history imported</p>
          <ProviderList names={missing} />
        </div>
      )}
    </section>
  );
}
function monthStarts(start, end) {
  const year = new Date(start).getUTCFullYear();
  return Array.from({ length: 12 }, (_, m) => Date.UTC(year, m, 1)).filter(
    (month) => month >= start && month < end,
  );
}
const YearGrid = memo(function YearGrid({
  names,
  records,
  spans,
  start,
  end,
  year,
  spend,
  select,
}) {
  const pct = (t) => (100 * (t - start)) / (end - start) + "%";
  const style = (a, b) => ({
    left: pct(a),
    width: (100 * (b - a)) / (end - start) + "%",
  });
  const ticks = monthStarts(start, end);
  const latestBills = latestBillsByService(records, end);
  const asOf = end - day;
  const now = today >= start && today < end;
  const guides = (
    <>
      {ticks.map((t) => (
        <i key={t} className="guide" style={{ left: pct(t) }} />
      ))}
      {now && <i className="todayline" style={{ left: pct(today) }} />}
    </>
  );
  return (
    <>
      <div className="chartrow axis">
        <div>SERVICE</div>
        <div className="track">
          {ticks.map((t) => (
            <small key={t} style={{ left: `min(${pct(t)}, calc(100% - 2.5rem))` }}>
              <MonthLabel time={t} spend={spend}>{monthName(t)}</MonthLabel>
            </small>
          ))}
        </div>
        <div
          className="month-count"
          title="Calendar months with at least one covered day"
        >
          Months
        </div>
        <div className="bill-end" title={"Remaining covered days, including " + fmt(asOf, true)}>
          Days left
        </div>
      </div>
      {names.map((name) => {
        const key = serviceKey(name);
        const bill = latestBills.get(key);
        const remaining = billingDaysLeft(bill, asOf);
        const sources = records
          .filter(p => coveredServices(p).some(service => serviceKey(service) === key))
          .map(p => {
            const viaBundle = serviceKey(p.service) !== key;
            const plan = p.nonVideoServices && p.estimate?.plan;
            return {
              start: Date.parse(p.start),
              end: p.end ? Date.parse(p.end) : end,
              viaBundle,
              label: viaBundle ? p.service + " bundle" : plan || p.service,
            };
          });
        const soleBundle = sources[0]?.viaBundle && sources.every(
          source => source.viaBundle && source.label === sources[0].label,
        );
        const runs = [];
        for (const s of spans)
          if (s.services.includes(key)) {
            const basis = coverageBasis(s, key);
            const source = [...new Set(sources.filter(p => p.start < s.end && s.start < p.end)
              .map(p => p.label))].sort().join(" + ");
            const previous = runs.at(-1);
            if (previous?.end === s.start && previous.basis === basis && previous.source === source)
              previous.end = s.end;
            else runs.push({ start: s.start, end: s.end, basis, source });
          }
        const months = ticks.filter((start, i) =>
          runs.some(
            (run) => run.start < (ticks[i + 1] ?? end) && start < run.end,
          ),
        ).length;
        return (
          <div className="chartrow" key={name}>
            <div className="service">
              <ProviderLabel name={name}>
                {soleBundle && <small className="bundle-source">via {sources[0].label}</small>}
              </ProviderLabel>
            </div>
            <div className="track">
              {guides}
              {runs.map((r) => {
                const detail = [
                  fmt(r.start, true) + " – " + fmt(r.end - day, true),
                  (r.end - r.start) / day + " days",
                  basisLabel[r.basis],
                ];
                if (r.source !== name) detail.push(r.source);
                const description = detail.join(" · ");
                return (
                  <button
                    className={"bar " + r.basis}
                    key={r.start}
                    style={{
                      ...style(r.start, r.end),
                      "--ink": brand(name).color,
                    }}
                    title={name + " · " + description}
                    aria-label={name + " · " + description}
                    onClick={() => select({ title: name, body: description })}
                  />
                );
              })}
            </div>
            <div className="month-count" aria-label={months + " active months"}>
              {months}
            </div>
            <div className="bill-end" title={bill?.end
              ? "Coverage through " + fmt(Date.parse(bill.end) - day, true) + " · as of " + fmt(asOf, true)
              : undefined}>
              {remaining !== null ? remaining + (remaining === 1 ? " day" : " days") : bill ? "End unknown" : "—"}
            </div>
          </div>
        );
      })}
      {!names.length && (
        <p className="empty">No coverage recorded for {year}.</p>
      )}
    </>
  );
});

function Timeline({ names, records, spans, start, end, year, spend, select }) {
  const now = today >= start && today < end;
  const stats = dailyServiceStats(spans);
  const months = monthStarts(start, end);
  const monthly = months.map((from, i) => dailyServiceStats(spans, from, months[i + 1] ?? end));
  const peak = Math.max(...monthly.map(m => Math.max(m.average, m.median)));
  return (
    <section className="panel">
      <div className="panelhead timeline-head">
        <div>
          <h2>Subscription timeline</h2>
          {stats && <div className="service-trends">
            <span>Services per day</span>
            {["average", "median"].map(metric => {
              const label = metric === "average" ? "Average" : "Median";
              const format = value => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
              const values = monthly.map(m => m[metric]);
              const labels = values.map((value, i) => monthName(months[i]) + " " + format(value));
              return <span className="service-trend" key={metric}>
                {label} <strong>{format(stats[metric])}</strong>
                <Sparkline values={values} peak={peak} labels={labels} label={label + " services per day by month"} />
              </span>;
            })}
          </div>}
        </div>
        <span className="yearstamp">
          <Icon type="calendar" />
          {fmt(start)} – {fmt(end - day, true)}
        </span>
      </div>
      <div className="scroll">
        <div className="chart">
          <YearGrid {...{ names, records, spans, start, end, year, spend, select }} />
        </div>
      </div>
      <footer className="legend">
        <span>
          <b className="swatch" />
          Recorded period
        </span>
        {spans.some((s) => s.billingCycle.length) && (
          <span>
            <b className="cyclekey" />
            Billing cycle
          </span>
        )}
        {spans.some((s) =>
          s.estimated.some((name) => !s.billingCycle.includes(name)),
        ) && (
          <span>
            <b className="estimatekey" />
            Price match
          </span>
        )}
        {now && (
          <span>
            <b className="line" />
            Today
          </span>
        )}
      </footer>
    </section>
  );
}
const historyMonthFormat = new Intl.DateTimeFormat("en-US", {
  month: "long", year: "numeric", timeZone: "UTC",
});

function monthSpendDescription(spend, time) {
  const totals = spend.months.get(iso(time).slice(0, 7));
  const amounts = Array.from(totals, ([currency, minor]) => formatCharge(minor, currency));
  return amounts.length ? "Recorded spend · " + amounts.join(" / ") : "No recorded payments";
}

function MonthLabel({ time, spend, children }) {
  const description = monthSpendDescription(spend, time);
  return (
    <span className="month-label" tabIndex={0} aria-label={historyMonthFormat.format(time) + ". " + description}>
      {children}
      <span className="month-tooltip" aria-hidden="true">{description}</span>
    </span>
  );
}

function ViewingCard({ view }) {
  // Netflix puts season and episode in the title. A colon alone is also
  // common in movie titles, so split only at an explicit season marker.
  const netflixEpisode = !view.series && serviceKey(view.service) === "netflix"
    ? /^(.+?): Season (\d+): (.+)$/i.exec(view.title)
    : null;
  const title = view.series || netflixEpisode?.[1] || view.title;
  const season = view.season || netflixEpisode?.[2];
  const episode = netflixEpisode?.[3] || (view.series && view.title !== view.series ? view.title : null);
  const search = new URLSearchParams({ q: title, s: "tt" });
  return (
    <li className="view-card" style={{ "--ink": brand(view.service).color }}>
      <ProviderLabel name={view.service} />
      <h4>{title}</h4>
      {season && <small className="view-season">Season {season}</small>}
      {episode && <p>{episode}</p>}
      <div className="view-card-footer">
        <time dateTime={view.lastPlayedAt || view.date}>
          {fmt(Date.parse(view.date))}
          {view.lastPlayedAt && " · " + view.lastPlayedAt.slice(11)}
        </time>
        <a href={"https://www.imdb.com/find/?" + search} target="_blank" rel="noreferrer"
          aria-label={"Find " + title + " on IMDb"}>
          Find on IMDb <span aria-hidden="true">↗</span>
        </a>
      </div>
    </li>
  );
}

function ViewingHistory({ viewing, year, spend, services, query, navigate }) {
  const included = new Set(query.getAll("include").map(serviceKey));
  const excluded = new Set(query.getAll("exclude").map(serviceKey));
  const filtered = included.size > 0 || excluded.size > 0;
  const visible = viewing.filter(view => {
    const key = serviceKey(view.service);
    return !excluded.has(key) && (!included.size || included.has(key));
  });
  function cycle(key) {
    const include = new Set(included), exclude = new Set(excluded);
    if (exclude.has(key)) {
      exclude.delete(key);
      include.delete(key);
    } else if (include.delete(key)) {
      exclude.add(key);
    } else include.add(key);
    navigate({ include: [...include], exclude: [...exclude] });
  }
  const months = new Map();
  for (const view of visible) {
    const month = view.date.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(view);
  }
  return (
    <section className="panel" aria-labelledby="viewing-heading">
      <div className="panelhead">
        <h2 id="viewing-heading">Viewing history</h2>
        <span aria-live="polite">{filtered ? visible.length + " of " : ""}{viewing.length} {viewing.length === 1 ? "entry" : "entries"}</span>
      </div>
      <div className="view-filters" role="group" aria-label="Filter viewing history by service">
        <p>Click a service once to include it, twice to exclude it, and again to clear.</p>
        <div className="filter-badges">
          {services.map(name => {
            const key = serviceKey(name);
            const state = excluded.has(key) ? "Excluded" : included.has(key) ? "Included" : "Neutral";
            return (
              <button key={key} type="button" data-state={state}
                aria-label={name + ", " + state.toLowerCase()}
                style={{ "--ink": brand(name).color }} onClick={() => cycle(key)}>
                <ProviderLabel name={name} />
                <span className="filter-state">{state}</span>
              </button>
            );
          })}
          {filtered && <button type="button" className="clear-filters" onClick={() => navigate({ include: null, exclude: null })}>Clear filters</button>}
        </div>
      </div>
      {Array.from(months, ([month, views]) => (
        <section className="view-month" key={month}>
          <h3><MonthLabel time={Date.parse(month + "-01")} spend={spend}>
            {historyMonthFormat.format(Date.parse(month + "-01"))}
          </MonthLabel></h3>
          <ul className="view-grid">
            {views.map((view) => <ViewingCard key={viewingKey(view)} view={view} />)}
          </ul>
        </section>
      ))}
      {!visible.length && <p className="empty">{viewing.length
        ? "No viewing entries match the selected services."
        : "No viewing entries for " + year + "."}</p>}
    </section>
  );
}

function MetricAmount({ totals, field }) {
  if (!totals.length) return "—";
  return totals.map((total) => (
    <span className="metric-amount" key={total.currency}>
      {total[field] === null ? "—" : formatCharge(total[field], total.currency)}
      {totals.length > 1 && <span className="metric-currency"> {total.currency}</span>}
    </span>
  ));
}
function Sparkline({ values, peak = Math.max(...values), label, labels }) {
  const points = values.map((value, i) => [
    values.length === 1 ? 40 : 2 + 76 * i / (values.length - 1),
    peak ? 22 - 20 * value / peak : 22,
  ]);
  const last = points.at(-1);
  return <svg className="sparkline" viewBox="0 0 80 24" role="img" aria-label={label + ". " + labels.join(", ")}>
    <title>{label}</title>
    <polyline points={points.map(point => point.join(",")).join(" ")} />
    <circle cx={last[0]} cy={last[1]} r="2" />
    {points.map(([x], i) => {
      const left = i ? (x + points[i - 1][0]) / 2 : 0;
      const right = i + 1 < points.length ? (x + points[i + 1][0]) / 2 : 80;
      return <rect key={i} x={left} width={right - left} height="24" fill="transparent"><title>{labels[i]}</title></rect>;
    })}
  </svg>;
}
function MonthlyAverage({ spend }) {
  if (!spend.averages.length) return "—";
  return spend.averages.map(({ currency, averageMinor, values }) => {
    return (
      <span className="average-row" key={currency}>
        <span>{formatCharge(averageMinor, currency)}
          {spend.averages.length > 1 && <span className="metric-currency"> {currency}</span>}
        </span>
        <Sparkline values={values} label={currency + " monthly recorded spend, oldest first"}
          labels={Array.from(spend.months.keys(), (month, i) => monthName(Date.parse(month + "-01")) + " " + formatCharge(values[i], currency))} />
      </span>
    );
  });
}
function ViewingCost({ ledger, windowReport, spend, start, end, year, viewCount, grouping = "Total", setGrouping }) {
  const months = monthStarts(start, end);
  const buckets = grouping === "Month"
    ? months.map((from, i) => ({
        from,
        end: months[i + 1] ?? end,
        label: monthName(from) + " " + year,
      }))
    : [{ from: start, end, label: year === currentYear ? year + " YTD" : year }];
  const rows = [];
  const coverage = [];
  for (const bucket of buckets) {
    const monthSpend = grouping === "Month" ? monthSpendDescription(spend, bucket.from) : undefined;
    const report = grouping === "Month"
      ? pricePerViewReport(ledger, bucket.from, bucket.end)
      : windowReport;
    for (const row of report.rows) rows.push({ ...row, label: bucket.label, monthSpend });
    for (const service of report.coverage) {
      coverage.push({
        ...service,
        label: bucket.label,
        monthSpend,
        days: (bucket.end - bucket.from) / day,
      });
    }
  }
  return (
    <section className="panel">
      <div className="panelhead">
        <div>
          <h2>Price per view</h2>
          <p>
            {fmt(start)} – {fmt(end - day, true)} · {viewCount} recorded{" "}
            {viewCount === 1 ? "view" : "views"}
          </p>
        </div>
        {setGrouping && (
          <select
            aria-label="Group price per view"
            value={grouping}
            onChange={(e) => setGrouping(e.target.value)}
          >
            {["Total", "Month"].map((opt) => (
              <option key={opt}>{opt}</option>
            ))}
          </select>
        )}
      </div>
      {rows.length ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Period",
                  "Service or bundle",
                  "Currency",
                  "Cost for period",
                  "Views counted",
                  "Cost per view",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={JSON.stringify([r.label, r.members, r.currency])}>
                  <td title={r.monthSpend}>{r.label}</td>
                  <td><ProviderList names={r.members} /></td>
                  <td>{r.currency}</td>
                  <td>{formatCharge(r.costMinor, r.currency)}</td>
                  <td>{r.views}</td>
                  <td>
                    {r.perViewMinor === null
                      ? "—"
                      : formatCharge(r.perViewMinor, r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">No video pricing available for this period.</p>
      )}
      {coverage.length > 0 && (
        <div className="billing-coverage">
          <details>
            <summary>Which views count?</summary>
            <p>A view counts when it falls within a bill with a known video price.</p>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Period</th><th>Service</th>
                    <th>Days with a video price</th><th>Views counted</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((service) => (
                    <tr key={JSON.stringify([service.label, serviceKey(service.service)])}>
                      <td title={service.monthSpend}>{service.label}</td>
                      <td><ProviderLabel name={service.service} /></td>
                      <td>{service.pricedDays} of {service.days}</td>
                      <td>{service.matched} of {service.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
function useDashboardQuery() {
  const [search, setSearch] = useState(() => window.location.search);
  useEffect(() => {
    const restore = () => setSearch(window.location.search);
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function navigate(changes) {
    const url = new URL(window.location.href);
    for (const [name, value] of Object.entries(changes)) {
      url.searchParams.delete(name);
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(name, item);
      } else if (value != null) url.searchParams.set(name, value);
    }
    if (url.href === window.location.href) return;
    window.history.pushState(null, "", url);
    setSearch(url.search);
  }
  return [new URLSearchParams(search), navigate];
}

function App({ initialLedger }) {
  const [ledger, setLedger] = useState(() => initialLedger ?? empty()),
    [temporary, setTemporary] = useState(false),
    [modal, setModal] = useState(null);
  const [query, navigate] = useDashboardQuery();
  const years = historyYears(ledger, today);
  const year = years.find((y) => String(y) === query.get("year")) ?? currentYear;
  const tabs = ledger.viewing?.length
    ? ["Timeline", "Records", "Viewing"]
    : ["Timeline", "Records"];
  const view = tabs.find((v) => v.toLowerCase() === query.get("view")) ?? "Timeline";
  const includeEstimates = query.get("estimates") !== "off";
  const grouping = query.get("group") === "month" ? "Month" : "Total";
  const minimum = [60, 90].find((n) => String(n) === query.get("idle")) ?? 30;
  const start = Date.UTC(year, 0, 1),
    end = Math.min(today + day, Date.UTC(year + 1, 0, 1));
  const visibleLedger = includeEstimates
    ? ledger
    : { ...ledger, periods: ledger.periods.filter((p) => !p.estimate || p.lastCoveredOn || p.refunded) };
  const spans = history(visibleLedger, start, end);
  const overlapsWindow = (p) => Date.parse(p.start) < end && (!p.end || Date.parse(p.end) > start);
  const records = [...coveredPeriods(visibleLedger.periods)].filter(overlapsWindow);
  const firstDate = iso(start), endDate = iso(end);
  const recordIds = new Set(records.map(p => p.id));
  const billingRecords = visibleLedger.periods.filter(p => {
    const charged = p.chargedOn ?? p.start;
    return recordIds.has(p.id) || (p.amountMinor != null && firstDate <= charged && charged < endDate);
  });
  const viewing = (ledger.viewing || [])
    .filter((v) => firstDate <= v.date && v.date < endDate)
    .sort((a, b) =>
      (b.lastPlayedAt || b.date).localeCompare(a.lastPlayedAt || a.date),
    );
  const names = [
    ...new Map(
      records
        .flatMap(coveredServices)
        .map((name) => [serviceKey(name), name.trim()]),
    ).values(),
  ];
  const windowReport = pricePerViewReport(visibleLedger, start, end);
  const spend = monthlySpend(visibleLedger.periods, start, end);
  const matchedViews = windowReport.coverage.reduce((n, service) => n + service.matched, 0);
  function apply(input, mode) {
    const next = mode === "merge" ? merge(ledger, input) : input;
    setLedger(next);
    setTemporary(true);
    const changes = { estimates: null };
    if (input.viewing?.length && !input.periods.length) changes.view = "viewing";
    else if (!next.viewing?.length && query.get("view") === "viewing") changes.view = null;
    if (mode === "replace") Object.assign(changes, { year: null, include: null, exclude: null });
    navigate(changes);
    setModal(null);
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([writeYaml(ledger)], { type: "application/yaml" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "history.yml";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <header>
        <div className="top">
          <div className="logo">
            <span className="sig" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            strmr<span className="logodot">.</span>
          </div>
          <div className="actions">
            <button onClick={download}>
              <Icon type="export" />
              Export YAML
            </button>
            <button className="primary" onClick={() => setModal("import")}>
              <Icon type="import" />
              Import data
            </button>
          </div>
        </div>
      </header>
      <main>
        <div className="titleline">
          <div>
            <h1>
              Subscription history<span>.</span>
            </h1>
          </div>
          <div className="yearcontrol" role="group" aria-label="History period">
            {years.map((option) => (
              <button
                key={option}
                aria-pressed={year === option}
                onClick={() => navigate({ year: option === currentYear ? "ytd" : option })}
              >
                {option === currentYear ? "YTD" : option}
              </button>
            ))}
          </div>
        </div>
        <div className="stats">
          {[
            ["cost", "Total cost", <MetricAmount totals={spend.averages} field="totalMinor" />,
              spend.averages.length ? "Recorded payments" : "No recorded payments"],
            ["calendar", "Average monthly spend", <MonthlyAverage spend={spend} />,
              spend.averages.length ? "Recorded payments across " + spend.months.size + (spend.months.size === 1 ? " month" : " months") : "No recorded payments"],
            ["viewing", "Views", viewing.length.toLocaleString(), fmt(start) + " – " + fmt(end - day, true)],
            ["rate", "Cost per view", <MetricAmount totals={windowReport.totals} field="perViewMinor" />,
              matchedViews.toLocaleString() + " of " + viewing.length.toLocaleString() + " views matched to a bill"],
          ].map(([icon, label, value, hint]) => (
            <article className="stat" key={label}>
              <div className="statlabel">
                <Icon type={icon} />
                {label}
              </div>
              <strong>{value}</strong>
              <small>{hint}</small>
            </article>
          ))}
        </div>
        <div className="viewbar">
          <nav aria-label="History view">
            {tabs.map((v) => (
              <button
                aria-pressed={view === v}
                key={v}
                onClick={() => navigate({ view: v.toLowerCase() })}
              >
                <Icon type={v.toLowerCase()} />
                {v}
              </button>
            ))}
          </nav>
          <span className="dataset">
            {temporary ? "Imported in browser" : initialLedger ? "data/history.yml" : "No file loaded"}
          </span>
        </div>
        {ledger.periods.some((p) => p.estimate) && (
          <label className="include-estimates">
            <input
              type="checkbox"
              checked={includeEstimates}
              onChange={(e) => navigate({ estimates: e.target.checked ? null : "off" })}
            />
            Include coverage derived from charge dates
          </label>
        )}
        {view === "Viewing" ? (
          <>
            <ViewingCost
              windowReport={windowReport}
              ledger={visibleLedger}
              {...{ start, end, year, spend }}
              viewCount={viewing.length}
              grouping={grouping}
              setGrouping={(value) => navigate({ group: value === "Month" ? "month" : null })}
            />
            <ViewingHistory {...{ viewing, year, spend, query, navigate }}
              services={[...new Map(ledger.viewing.map(v => [serviceKey(v.service), v.service.trim()])).values()]
                .sort((a, b) => a.localeCompare(b))} />
          </>
        ) : view === "Timeline" ? (
          <>
            <Timeline
              {...{ names, records, spans, start, end, year, spend }}
              select={setModal}
            />
            <ViewingCost
              windowReport={windowReport}
              ledger={visibleLedger}
              {...{ start, end, year, spend }}
              viewCount={viewing.length}
            />
            <IdlePeriods
              ledger={visibleLedger}
              {...{ start, end, names, minimum }}
              setMinimum={(value) => navigate({ idle: value === 30 ? null : value })}
            />
          </>
        ) : (
          <section className="panel">
            <div className="panelhead">
              <h2>Subscription records</h2>
              <span>{billingRecords.length} records</span>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "Service",
                      "Start",
                      "End (exclusive)",
                      "Source",
                      "Amount paid",
                    ].map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...billingRecords]
                    .sort((a, b) => a.start.localeCompare(b.start))
                    .map((p) => (
                      <tr key={p.id}>
                        <td>
                          <ProviderLabel name={p.service} />
                        </td>
                        <td>{p.refunded ? "—" : p.start}</td>
                        <td>{p.refunded ? "Canceled" : p.lastCoveredOn ? iso(Date.parse(p.lastCoveredOn) + day) : p.end || "Ongoing"}</td>
                        <td>
                          {p.source}
                          {p.estimate && !p.refunded && !p.lastCoveredOn && (
                            <details>
                              <summary>
                                {p.estimate.basis === "mapsub"
                                  ? "Historical price match"
                                  : "Plan billing cycle"}
                              </summary>
                              {p.estimate.plan} · {p.estimate.cycle}
                              <br />
                              {p.estimate.basis === "mapsub" ? (
                                <>
                                  Price observed {p.estimate.firstSeen} through{" "}
                                  {p.estimate.lastSeen}
                                  <br />
                                  <a
                                    href={p.estimate.evidenceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Pricing evidence
                                  </a>
                                </>
                              ) : (
                                <>
                                  One cycle from the charge date. Adjustments
                                  may cover fewer days.
                                </>
                              )}
                            </details>
                          )}
                        </td>
                        <td>
                          {p.amountMinor == null
                            ? "—"
                            : formatCharge(amountPaidMinor(p), p.currency)}
                          {p.refunded && <small className="record-note">{fmt(Date.parse(p.chargedOn ?? p.start), true)}</small>}
                          {p.nonVideoServices && <small className="record-note">
                            Includes {p.nonVideoServices.join(", ")}
                          </small>}
                          {p.subtotalMinor != null && (
                            <details>
                              <summary>Charge details</summary>
                              {p.chargedOn && (
                                <>
                                  Charged {p.chargedOn}
                                  <br />
                                </>
                              )}
                              {formatCharge(p.subtotalMinor, p.currency)} +{" "}
                              {formatCharge(p.taxMinor, p.currency)} tax
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!billingRecords.length && (
                <p className="empty">No records for {year}.</p>
              )}
            </div>
          </section>
        )}
        <div className="footnote">
          <span className="minilogo">strmr.</span>
          {temporary && <span>Export YAML to save these changes.</span>}
          {!temporary && !initialLedger && <span>Import a history file to get started.</span>}
        </div>
      </main>
      {modal === "import" ? (
        <Import close={() => setModal(null)} apply={apply} />
      ) : (
        modal && (
          <Dialog title={modal.title} close={() => setModal(null)}>
            <p>{modal.body}</p>
          </Dialog>
        )
      )}
    </>
  );
}
async function openDashboard() {
  let ledger = null;
  const root = createRoot(document.getElementById("root"));
  if (import.meta.env.DEV) {
    try {
      const response = await fetch(
        import.meta.env.BASE_URL + "data/history.yml",
        {
          headers: { Accept: "application/yaml" },
          cache: "no-store",
        },
      );
      if (response.ok) ledger = readYaml(await response.text());
      else if (response.status !== 404)
        throw new Error("HTTP " + response.status);
    } catch (error) {
      root.render(
        <main role="alert">
          <h1>Couldn’t open data/history.yml</h1>
          <p>{error.message}</p>
        </main>,
      );
      return;
    }
  }
  root.render(<App initialLedger={ledger} />);
}
openDashboard();
