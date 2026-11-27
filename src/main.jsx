import React, { useState, useRef, useEffect, useMemo, memo } from "react";
import { createRoot } from "react-dom/client";
import {
  day,
  empty,
  iso,
  inactivity,
  history,
  pricePerView,
  coveredServices,
  serviceKey,
  readYaml,
  writeYaml,
  readHistoryInput,
  viewingKey,
  merge,
} from "./ledger.js";
import "./style.css";

const colors = [
  "#fa787b",
  "#80d39f",
  "#a191e5",
  "#a7bace",
  "#79a8ef",
  "#e6bc79",
];
const brands = {
  netflix: ["N", 0],
  hulu: ["hulu", 1],
  "hbo max": ["max", 2],
  "apple tv+": ["tv+", 3],
  "disney+": ["D+", 4],
};
const localDate = new Date();
const today = Date.UTC(
  localDate.getFullYear(),
  localDate.getMonth(),
  localDate.getDate(),
);
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
  const [mark, index] = (Object.hasOwn(brands, serviceKey(name)) &&
    brands[serviceKey(name)]) || [name.trim().slice(0, 2).toUpperCase(), 5];
  return { mark, color: colors[index] };
}
function Icon({ type }) {
  const paths = {
    import: "M12 15V3m-5 5 5-5 5 5M4 14v6h16v-6",
    export: "M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4",
    calendar: "M3 6h18v15H3zM3 10h18M7 3v6m10-6v6",
    layers: "m12 3 9 5-9 5-9-5zM3 12l9 5 9-5m-18 4 9 5 9-5",
    overlap: "M3 5h11v11H3zM10 9h11v11H10z",
    peak: "M3 20V12h4v8m3 0V7h4v13m3 0V3h4v17",
    timeline: "M3 5h12M8 12h13M3 19h10",
    viewing:
      "M2 12 Q12 -2 22 12 Q12 26 2 12z M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0",
    records: "M4 4h16v16H4zM4 9h16M4 14h16",
    left: "m14 6-6 6 6 6",
    right: "m10 6 6 6-6 6",
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
  const { color, mark } = brand(name);
  return (
    <span className="mark" aria-hidden="true" style={{ "--ink": color }}>
      {mark}
    </span>
  );
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
      const next = await readHistoryInput(input, file.name);
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
            Paste Hulu or Netflix payment history (USD)
          </option>
        </select>
      </label>
      {entry === "file" ? (
        <>
          <p>
            Open a Hulu privacy report PDF, NetflixViewingHistory.csv, a Hulu or
            Netflix payment history .txt, a strmr YAML ledger or a CSV with
            service, start, and end columns. Use the first uncovered day for
            end. Leave it blank for ongoing subscriptions.
          </p>
          <p>
            For charges, use service, date, and cycle (monthly or annual). Each
            charge covers one cycle starting on its date. Leave cycle blank and
            supply amountMinor and currency to estimate it from a matching
            historical list price.{" "}
            <a href="https://mapsub.com/data/" target="_blank" rel="noreferrer">
              MapSub price history
            </a>
          </p>
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
          Hulu or Netflix payment history (US dollars)
          <textarea
            rows={6}
            placeholder="Paste the payment table with column headers and charge totals"
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
function DayInspector({ time, ledger, names, span, start, end, pick }) {
  const date = iso(time);
  const byDate = useMemo(() => {
    const days = new Map();
    for (const view of ledger.viewing || []) {
      if (!days.has(view.date)) days.set(view.date, []);
      days.get(view.date).push(view);
    }
    return days;
  }, [ledger.viewing]);
  const views = byDate.get(date) || [];
  const costs =
    time <= today
      ? pricePerView({ ...ledger, viewing: views }, time, time + day)
      : [];
  const active = names.filter((name) =>
    span?.services.includes(serviceKey(name)),
  );
  return (
    <section className="day-inspector" aria-label="Day details">
      <div className="day-heading">
        <h3>{fmt(time, true)}</h3>
        <input
          type="date"
          aria-label="Inspect date"
          value={date}
          min={iso(start)}
          max={iso(end - day)}
          onChange={(e) => {
            const t = e.target.valueAsNumber;
            if (t >= start && t < end) pick(t);
          }}
        />
      </div>
      <div className="day-columns">
        <div className="day-coverage">
          {time > today ? (
            <p>Future date · History runs through {fmt(today, true)}.</p>
          ) : (
            <p>
              <strong>
                {active.length} active{" "}
                {active.length === 1 ? "service" : "services"}
              </strong>
              {" · "}
              {views.length} recorded {views.length === 1 ? "view" : "views"}
            </p>
          )}
          <ul className="daily-services">
            {active.map((name) => (
              <li key={name}>
                <Mark name={name} />
                <span>
                  {name}
                  <small>
                    {basisLabel[coverageBasis(span, serviceKey(name))]}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="day-charges">
          <table>
            <thead>
              <tr>
                <th>Service or bundle</th>
                <th>Allocated daily cost</th>
                <th>Covered views</th>
                <th>Cost per view</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((r) => (
                <tr key={JSON.stringify([r.service, r.currency])}>
                  <td>{r.service}</td>
                  <td>
                    {formatCharge(r.costMinor, r.currency)} {r.currency}
                  </td>
                  <td>{r.views}</td>
                  <td>
                    {r.perViewMinor === null
                      ? "—"
                      : formatCharge(r.perViewMinor, r.currency)}
                  </td>
                </tr>
              ))}
              {!costs.length && (
                <tr>
                  <td colSpan={4}>No allocated cost for this day.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
function IdlePeriods({ ledger, start, end, names }) {
  const [minimum, setMinimum] = useState(30);
  const gaps = inactivity(ledger, today + day, minimum).filter(
    (g) => g.start < end && g.end > start,
  );
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
                  <td>{g.name}</td>
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
        <p className="empty">
          No viewing history imported for {missing.join(", ")}.
        </p>
      )}
    </section>
  );
}
const YearGrid = memo(function YearGrid({
  names,
  spans,
  start,
  end,
  year,
  select,
}) {
  const pct = (t) => (100 * (t - start)) / (end - start) + "%";
  const style = (a, b) => ({
    left: pct(a),
    width: (100 * (b - a)) / (end - start) + "%",
  });
  const ticks = Array.from({ length: 12 }, (_, i) => Date.UTC(year, i, 1));
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
            <small key={t} style={{ left: pct(t) }}>
              {monthName(t)}
            </small>
          ))}
        </div>
        <div
          className="month-count"
          title="Calendar months with at least one covered day"
        >
          Months
        </div>
      </div>
      {names.map((name) => {
        const runs = [];
        for (const s of spans)
          if (s.services.includes(serviceKey(name))) {
            const basis = coverageBasis(s, serviceKey(name));
            if (runs.at(-1)?.end === s.start && runs.at(-1).basis === basis)
              runs.at(-1).end = s.end;
            else runs.push({ start: s.start, end: s.end, basis });
          }
        const months = ticks.filter((start, i) =>
          runs.some(
            (run) => run.start < (ticks[i + 1] ?? end) && start < run.end,
          ),
        ).length;
        return (
          <div className="chartrow" key={name}>
            <div className="service">
              <Mark name={name} />
              {name}
            </div>
            <div className="track">
              {guides}
              {runs.map((r) => (
                <button
                  className={"bar " + r.basis}
                  key={r.start}
                  style={{
                    ...style(r.start, r.end),
                    "--ink": brand(name).color,
                  }}
                  title={name + " · " + fmt(r.start) + " – " + fmt(r.end - day)}
                  aria-label={
                    name +
                    (" · " + basisLabel[r.basis] + " · ") +
                    fmt(r.start) +
                    " through " +
                    fmt(r.end - day)
                  }
                  onClick={() =>
                    select({
                      title: name,
                      body:
                        fmt(r.start, true) +
                        " – " +
                        fmt(r.end - day, true) +
                        " · " +
                        (r.end - r.start) / day +
                        (" days · " + basisLabel[r.basis]),
                    })
                  }
                />
              ))}
            </div>
            <div className="month-count" aria-label={months + " active months"}>
              {months}
            </div>
          </div>
        );
      })}
      {!names.length && (
        <p className="empty">No coverage recorded for {year}.</p>
      )}
      <div className="chartrow density">
        <div className="service">
          <Icon type="overlap" />
          Overlap
        </div>
        <div className="track">
          {guides}
          {spans
            .filter((s) => s.services.length > 1)
            .map((s) => (
              <button
                key={s.start}
                className="densitybar"
                style={{
                  ...style(s.start, s.end),
                  opacity: Math.min(1, 0.45 + s.services.length * 0.12),
                }}
                title={s.services.join(", ")}
                aria-label={
                  "Inspect " +
                  s.services.length +
                  " services on " +
                  fmt(s.start)
                }
                onClick={() =>
                  select({
                    title: s.services.length + " overlapping services",
                    body:
                      fmt(s.start, true) +
                      " – " +
                      fmt(s.end - day, true) +
                      (s.estimated.length
                        ? " · Dates derived from charges for " +
                          names
                            .filter((n) => s.estimated.includes(serviceKey(n)))
                            .join(", ")
                        : ""),
                    list: names.filter((n) =>
                      s.services.includes(serviceKey(n)),
                    ),
                  })
                }
              >
                {(s.end - s.start) / (end - start) > 0.038
                  ? s.services.length
                  : ""}
              </button>
            ))}
        </div>
      </div>
    </>
  );
});

function Timeline({ names, spans, start, end, year, select, ledger }) {
  const [selected, setSelected] = useState(Math.min(today, end - day));
  function inspect(event) {
    const track = event.target.closest(".track");
    if (!track) return;
    const { left, width } = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - left) / width));
    setSelected(
      Math.min(
        end - day,
        start + Math.floor((fraction * (end - start)) / day) * day,
      ),
    );
  }
  const now = today >= start && today < end;
  return (
    <section className="panel">
      <div className="panelhead">
        <div>
          <h2>Subscription timeline</h2>
          <p>Hover over a day to inspect services, views and cost.</p>
        </div>
        <span className="yearstamp">
          <Icon type="calendar" />
          {year}
        </span>
      </div>
      <div className="scroll">
        <div
          className="chart"
          style={{
            "--selected":
              (100 * (selected + day / 2 - start)) / (end - start) + "%",
          }}
          onPointerMove={inspect}
          onPointerDown={inspect}
        >
          <YearGrid {...{ names, spans, start, end, year, select }} />
        </div>
      </div>
      <DayInspector
        time={selected}
        start={start}
        end={end}
        ledger={ledger}
        names={names}
        span={spans.find((s) => s.start <= selected && selected < s.end)}
        pick={setSelected}
      />
      <footer className="legend">
        <span>
          <b className="swatch" />
          Recorded period
        </span>
        <span>
          <b className="striped" />
          Overlapping services
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
function ViewingCost({ ledger, year }) {
  const [span, setSpan] = useState("Year");
  const buckets =
    span === "Month"
      ? Array.from({ length: 12 }, (_, m) => ({
          label: monthName(Date.UTC(year, m, 1)) + " " + year,
          from: Date.UTC(year, m, 1),
          end: Date.UTC(year, m + 1, 1),
        }))
      : [
          {
            label: span === "Year" ? String(year) : "All time",
            from: span === "Year" ? Date.UTC(year, 0, 1) : -Infinity,
            end: span === "Year" ? Date.UTC(year + 1, 0, 1) : Infinity,
          },
        ];
  const rows = buckets.flatMap((b) =>
    pricePerView(ledger, b.from, Math.min(b.end, today + day)).map((row) => ({
      ...row,
      label: b.label,
    })),
  );
  return (
    <section className="panel">
      <div className="panelhead">
        <div>
          <h2>Price per view</h2>
          <p>
            Charges spread across covered days, divided by views on those days.
          </p>
        </div>
        <select
          aria-label="Price per view period"
          value={span}
          onChange={(e) => setSpan(e.target.value)}
        >
          {["Month", "Year", "All time"].map((opt) => (
            <option key={opt}>{opt}</option>
          ))}
        </select>
      </div>
      {rows.length ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                {[
                  "Period",
                  "Service",
                  "Currency",
                  "Cost",
                  "Views",
                  "Price per view",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={JSON.stringify([r.label, r.service, r.currency])}>
                  <td>{r.label}</td>
                  <td>{r.service}</td>
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
        <p className="empty">No priced coverage in this period.</p>
      )}
    </section>
  );
}
function latestYear(ledger) {
  const last = ledger.periods.reduce(
    (n, p) => Math.max(n, p.end ? Date.parse(p.end) - day : today),
    0,
  );
  const latestViewing = (ledger.viewing || []).reduce(
    (n, v) => Math.max(n, Date.parse(v.date)),
    0,
  );
  return new Date(
    Math.min(today, Math.max(last, latestViewing)) || today,
  ).getUTCFullYear();
}
function App({ initialLedger }) {
  const [ledger, setLedger] = useState(initialLedger),
    [temporary, setTemporary] = useState(false),
    [year, setYear] = useState(() => latestYear(initialLedger)),
    [includeEstimates, setIncludeEstimates] = useState(true),
    [view, setView] = useState("Timeline"),
    [modal, setModal] = useState(null);
  const start = Date.UTC(year, 0, 1),
    end = Date.UTC(year + 1, 0, 1);
  const until = Math.max(start, Math.min(today + day, end));
  const visibleLedger = includeEstimates
    ? ledger
    : { ...ledger, periods: ledger.periods.filter((p) => !p.estimate) };
  const spans = history(visibleLedger, start, until);
  const records = visibleLedger.periods.filter(
    (p) =>
      Date.parse(p.start) < until &&
      (!p.end || Date.parse(p.end) > start) &&
      until > start,
  );
  const viewing = (ledger.viewing || [])
    .filter((v) => v.date.startsWith(year + "-"))
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
  const days = spans.reduce(
    (n, s) => n + (s.services.length > 1 ? (s.end - s.start) / day : 0),
    0,
  );
  const peak = spans.reduce((n, s) => Math.max(n, s.services.length), 0);
  function apply(input, mode) {
    const next = mode === "merge" ? merge(ledger, input) : input;
    setLedger(next);
    setTemporary(true);
    setIncludeEstimates(true);
    if (input.viewing?.length && !input.periods.length) setView("Viewing");
    else if (view === "Viewing" && !next.viewing?.length) setView("Timeline");
    setYear(latestYear(next));
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
  const firstViewingYear = (ledger.viewing || []).reduce(
    (n, v) => Math.min(n, Number(v.date.slice(0, 4))),
    new Date(today).getUTCFullYear(),
  );
  const minYear = ledger.periods.reduce(
    (n, p) => Math.min(n, Number(p.start.slice(0, 4))),
    firstViewingYear,
  );
  const maxYear = new Date(today).getUTCFullYear();
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
            <p>Your streaming subscriptions and the time they shared.</p>
          </div>
          <div className="yearcontrol">
            <button
              aria-label="Previous year"
              disabled={year <= minYear}
              onClick={() => setYear(year - 1)}
            >
              <Icon type="left" />
            </button>
            <label>
              <Icon type="calendar" />
              <select
                aria-label="History year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {Array.from(
                  { length: Math.max(year, maxYear) - minYear + 1 },
                  (_, i) => (
                    <option key={i}>{minYear + i}</option>
                  ),
                )}
              </select>
            </label>
            <button
              aria-label="Next year"
              disabled={year >= maxYear}
              onClick={() => setYear(year + 1)}
            >
              <Icon type="right" />
            </button>
          </div>
        </div>
        <div className="stats">
          {[
            [
              "layers",
              "Tracked services",
              names.length,
              "with coverage this year",
            ],
            ["overlap", "Overlap days", days, "with two or more services"],
            ["peak", "Peak overlap", peak, "services at the same time"],
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
            {(ledger.viewing?.length
              ? ["Timeline", "Records", "Viewing"]
              : ["Timeline", "Records"]
            ).map((v) => (
              <button
                aria-pressed={view === v}
                key={v}
                onClick={() => setView(v)}
              >
                <Icon type={v.toLowerCase()} />
                {v}
              </button>
            ))}
          </nav>
          <span className="dataset">
            {temporary
              ? "Browser copy"
              : import.meta.env.DEV &&
                  (ledger.periods.length || ledger.viewing?.length)
                ? "Project ledger"
                : "Empty ledger"}
          </span>
        </div>
        {ledger.periods.some((p) => p.estimate) && (
          <label className="include-estimates">
            <input
              type="checkbox"
              checked={includeEstimates}
              onChange={(e) => setIncludeEstimates(e.target.checked)}
            />
            Include coverage derived from charge dates
          </label>
        )}
        {view === "Viewing" ? (
          <>
            <ViewingCost ledger={visibleLedger} year={year} />
            <section className="panel">
              <div className="panelhead">
                <h2>Viewing history</h2>
                <span>{viewing.length} entries</span>
              </div>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Service</th>
                      <th>Title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewing.map((v) => (
                      <tr key={viewingKey(v)}>
                        <td>{v.lastPlayedAt?.replace("T", " ") || v.date}</td>
                        <td>{v.service}</td>
                        <td>
                          {v.series && (
                            <>
                              {v.series}
                              {v.season && " · Season " + v.season}
                              <br />
                            </>
                          )}
                          {v.title}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!viewing.length && (
                  <p className="empty">No viewing entries for {year}.</p>
                )}
              </div>
            </section>
          </>
        ) : view === "Timeline" ? (
          <>
            <Timeline
              key={year}
              ledger={visibleLedger}
              {...{ names, spans, start, end, year }}
              select={setModal}
            />
            <IdlePeriods ledger={visibleLedger} {...{ start, end, names }} />
          </>
        ) : (
          <section className="panel">
            <div className="panelhead">
              <h2>Subscription records</h2>
              <span>{records.length} records</span>
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
                      "Charge",
                    ].map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...records]
                    .sort((a, b) => a.start.localeCompare(b.start))
                    .map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="service">
                            <Mark name={p.service} />
                            {p.service}
                          </div>
                        </td>
                        <td>{p.start}</td>
                        <td>{p.end || "Ongoing"}</td>
                        <td>
                          {p.source}
                          {p.estimate && (
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
                            : formatCharge(p.amountMinor, p.currency)}
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
              {!records.length && (
                <p className="empty">No records for {year}.</p>
              )}
            </div>
          </section>
        )}
        <div className="footnote">
          <span className="minilogo">strmr.</span>
          <span>
            {temporary
              ? "Browser copy · Export YAML to keep these changes."
              : import.meta.env.DEV
                ? "Project file · data/history.yml"
                : "Open a history file to view it here."}
          </span>
        </div>
      </main>
      {modal === "import" ? (
        <Import close={() => setModal(null)} apply={apply} />
      ) : (
        modal && (
          <Dialog title={modal.title} close={() => setModal(null)}>
            <p>{modal.body}</p>
            {modal.list?.map((name) => (
              <div key={name} className="detailservice">
                <Mark name={name} />
                {name}
              </div>
            ))}
          </Dialog>
        )
      )}
    </>
  );
}
async function openDashboard() {
  let ledger = empty();
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
          <h1>Couldn’t open the project ledger</h1>
          <p>Check data/history.yml and reload. {error.message}</p>
        </main>,
      );
      return;
    }
  }
  root.render(<App initialLedger={ledger} />);
}
openDashboard();
