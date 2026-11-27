import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import {
  day,
  history,
  inactivity,
  pricePerView,
  readCsv,
  readHistoryFile,
  readYaml,
  writeYaml,
  merge,
} from "../src/ledger.js";

const csv =
  "id,service,start,end\na,A,2024-02-28,2024-03-01\nb,a,2024-02-29,2024-03-01\nc,B,2024-02-29,2024-03-01\nd,C,2024-03-01,";
test("half-open periods, leap day, same-provider overlap and open end", () => {
  const spans = history(
    readCsv(csv),
    Date.parse("2024-02-27"),
    Date.parse("2024-03-03"),
  );
  assert.deepEqual(
    spans.map((s) => [s.services.length, (s.end - s.start) / day]),
    [
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
    ],
  );
});
test("reject invalid dates, reversed periods, duplicate ids and malformed charges", () => {
  for (const bad of [
    csv.replace("2024-02-28", "2024-02-30"),
    csv.replace("2024-02-28", "2024-03-01"),
    csv.replace("b,a", "a,a"),
    "service,start,end,amountMinor\nA,2024-01-01,,25",
  ])
    assert.throws(() => readCsv(bad));
});
test("calendar billing handles leap days and the last day of a month", () => {
  const { periods } = readCsv(
    "service,date,cycle\nA,2024-01-31,monthly\nB,2024-02-29,annual",
  );
  assert.deepEqual(
    periods.map((p) => p.end),
    ["2024-02-29", "2025-02-28"],
  );
});
test("merge is idempotent and refuses conflicting ids", () => {
  const ledger = readCsv(csv);
  assert.deepEqual(merge(ledger, readYaml(writeYaml(ledger))), ledger);
  assert.throws(
    () => merge(ledger, readCsv(csv.replace("a,A", "a,B"))),
    /Conflicting/,
  );
});
test("CLI creates an idempotent YAML ledger and a restorable ZIP", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "strmr-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "history.yml");
  const run = (...args) =>
    execFileSync(process.execPath, ["scripts/ledger.mjs", ...args], {
      encoding: "utf8",
    }).trim();
  const input = join(directory, "billing.csv");
  await writeFile(
    input,
    "service,start,end\nA,2024-01-01,2024-02-01\nB,2024-02-01,",
  );
  run("import", input, file);
  assert.match(
    run("import", input, file),
    /Added 0 subscription records and 0 viewing entries/,
  );
  assert.equal(readYaml(await readFile(file, "utf8")).periods.length, 2);
  const archive = unzipSync(await readFile(run("backup", file, directory)));
  assert.equal(strFromU8(archive["history.yml"]), await readFile(file, "utf8"));
});

const chargeHeader = "service,date,amountMinor,currency\n";
test("historical MapSub matches use charge date, amount, currency and one calendar cycle", () => {
  const imported = readCsv(
    chargeHeader + "Netflix,2024-01-31,1549,USD\nDisney+,2024-02-29,13999,USD",
  );
  const [monthly, annual] = imported.periods;
  assert.equal(monthly.estimate.plan, "Standard");
  assert.equal(monthly.estimate.cycle, "monthly");
  assert.equal(monthly.end, "2024-02-29");
  assert.equal(annual.end, "2025-02-28");
  assert.deepEqual(merge(imported, readYaml(writeYaml(imported))), imported);
  assert.throws(
    () => readYaml(writeYaml(imported).replace("2024-02-29", "2024-03-01")),
    /inconsistent/,
  );
});

test("observation boundaries are inclusive; gaps, stale prices, wrong currencies and add-ons require review", () => {
  for (const date of ["2025-01-22", "2026-02-25"]) {
    assert.equal(
      readCsv(chargeHeader + "Netflix," + date + ",1799,USD").periods[0]
        .estimate.plan,
      "Standard",
    );
  }
  for (const row of [
    "Netflix,2025-01-20,1799,USD",
    "Netflix,2024-01-15,1549,CAD",
    "Netflix,2026-03-01,1799,USD",
    "Netflix,2025-06-15,899,USD",
    "Hulu,2024-04-15,1,USD",
  ]) {
    assert.throws(
      () => readCsv(chargeHeader + row),
      /Supply its billing cycle/,
    );
  }
  assert.equal(
    readCsv(chargeHeader + "Netflix,2025-01-10,1099,GBP").periods[0].estimate
      .plan,
    "Standard",
  );
});

test("explicit windows and cycles take priority, and recorded coverage overrides estimates on shared days", () => {
  const estimated = readCsv(chargeHeader + "Netflix,2024-01-31,1549,USD");
  const recorded = readCsv(
    "service,start,end,date,amountMinor,currency\nNetflix,2024-02-01,2024-02-03,2024-02-02,10,USD",
  );
  assert.equal(recorded.periods[0].estimate, undefined);
  assert.equal(
    readCsv(
      "service,date,cycle,amountMinor,currency\nNetflix,2024-01-31,annual,1549,USD",
    ).periods[0].end,
    "2025-01-31",
  );
  const spans = history(
    merge(estimated, recorded),
    Date.parse("2024-01-31"),
    Date.parse("2024-02-10"),
  );
  assert.deepEqual(
    spans.map((s) => s.estimated),
    [["netflix"], [], ["netflix"]],
  );
});

test("Netflix US payments preserve inclusive coverage, charge date, subtotal and tax", () => {
  const text =
    "Payment History\n3/1/2024\nMembership for 2/29/2024–3/30/2024\n•••• 1234\nView\n$12.07\n$11.00 (+$1.07 tax)";
  const bill = readHistoryFile(text, "payment.txt");
  const [p] = bill.periods;
  assert.deepEqual(
    [p.chargedOn, p.start, p.end, p.amountMinor, p.subtotalMinor, p.taxMinor],
    ["2024-03-01", "2024-02-29", "2024-03-31", 1207, 1100, 107],
  );
  assert.ok(!writeYaml(bill).includes("1234"));
  assert.throws(
    () => readHistoryFile(text.replace("$12.07", "$13.07"), "x.txt"),
    /must equal/,
  );
  assert.throws(
    () => readHistoryFile(text + "\n4/1/2024\nMembership for", "x.txt"),
    /Incomplete/,
  );
});
test("Netflix viewing CSV merges across bills and repeated imports without adding coverage", () => {
  const watch = readCsv(
    'Title,Date\r\n"Example, episode one",2/29/24\r\nAnother title,3/1/2024',
  );
  const bills = readCsv(csv);
  const merged = merge(bills, watch);
  assert.deepEqual(
    merged.viewing.map((v) => v.date),
    ["2024-02-29", "2024-03-01"],
  );
  assert.deepEqual(merged.periods, bills.periods);
  assert.deepEqual(merge(readYaml(writeYaml(merged)), watch), merged);
  assert.deepEqual(merge(watch, bills), merged);
  assert.throws(() => readCsv("Title,Date\nExample,2/30/24"), /date/);
});

test("price per view prorates across years and counts views once within priced coverage", () => {
  const ledger = readCsv(
    "id,service,start,end,amountMinor,currency\na,A,2023-12-31,2024-01-02,200,USD\nb,A,2024-01-01,2024-01-02,50,USD\nc,B,2024-01-01,2024-01-02,500,CAD",
  );
  ledger.viewing = ["2023-11-01", "2023-12-31", "2024-01-01", "2024-01-02"].map(
    (date) => ({ service: "a", date, title: "One" }),
  );
  const all = pricePerView(ledger, -Infinity, Infinity);
  assert.deepEqual(
    all.map((r) => [r.currency, r.costMinor, r.views, r.perViewMinor]),
    [
      ["USD", 250, 2, 125],
      ["CAD", 500, 0, null],
    ],
  );
  const jan = pricePerView(
    ledger,
    Date.parse("2024-01-01"),
    Date.parse("2024-02-01"),
  );
  assert.equal(jan[0].perViewMinor, 150);
});

test("Hulu charges preserve bundle labels, same-day adjustments and totals across repeat imports", () => {
  const table =
    "Date\tDescription\tTotal\r\nJanuary 31, 2024\tDisney+, Hulu Bundle Premium (Monthly)\t$12.34\r\nJanuary 31, 2024\tDisney+, Hulu, ESPN Select Bundle Premium (Monthly)\t$2.00\r\nMarch 15, 2024\tHulu Premium (Monthly)\t$8.00";
  const ledger = readHistoryFile(table, "charges.txt");
  const [bundle, extra, direct] = ledger.periods;
  assert.equal(bundle.start, "2024-01-31");
  assert.equal(bundle.end, "2024-02-29");
  assert.equal(extra.estimate.basis, "billing-cycle");
  assert.equal(
    extra.estimate.plan,
    "Disney+, Hulu, ESPN Select Bundle Premium (Monthly)",
  );
  assert.equal(direct.amountMinor, 800);
  assert.deepEqual(merge(readYaml(writeYaml(ledger)), ledger), ledger);
  const spans = history(
    ledger,
    Date.parse("2024-01-31"),
    Date.parse("2024-03-16"),
  );
  assert.deepEqual(
    spans.map((s) => s.services.length),
    [3, 0, 1],
  );
  assert.deepEqual(spans[0].estimated, spans[0].services);
  ledger.viewing = [
    { service: "Disney+", date: "2024-02-01", title: "An episode" },
  ];
  const costs = pricePerView(ledger, -Infinity, Infinity);
  assert.equal(
    costs.reduce((sum, r) => sum + r.costMinor, 0),
    2234,
  );
  assert.equal(costs[0].views, 1);
  for (const bad of [
    table.replace("January 31", "February 30"),
    table.replace("$2.00", "Refund"),
    table.replace("Hulu Premium (Monthly)", "Unknown plan"),
    table + "\nApril 1, 2024",
  ]) {
    assert.throws(() => readHistoryFile(bad, "history.txt"));
  }
});

test("Hulu PDF table keeps wrapped cells, movies, and distinct same-day timestamps", async () => {
  const { watchPage } = await import("../src/hulu-report.js");
  const cell = (x, y, str) => ({ transform: [1, 0, 0, 1, x, y], str });
  const heading = [
    "Episode Name",
    "Series Name",
    "Season",
    "Last Played At",
  ].map((v, i) => cell(i * 100, 700, v));
  const rows = [
    ...heading,
    cell(0, 680, "Long"),
    cell(0, 669, "episode"),
    cell(100, 680, "Example series"),
    cell(200, 680, "3"),
    cell(300, 680, "01 Nov 2026 22:01:02"),
    cell(0, 640, "A movie"),
    cell(100, 640, "N/A"),
    cell(200, 640, "N/A"),
    cell(300, 640, "01 Nov 2026 22:50:00"),
    cell(0, 610, "A movie"),
    cell(100, 610, "N/A"),
    cell(200, 610, "N/A"),
    cell(300, 610, "01 Nov 2026 23:00:00"),
  ];
  const viewing = watchPage(rows);
  assert.equal(viewing[0].title, "Long episode");
  assert.equal(viewing[0].series, "Example series");
  assert.equal(viewing[0].season, "3");
  assert.equal(viewing[0].lastPlayedAt, "2026-11-01T22:01:02");
  assert.equal(viewing[1].series, undefined);
  const ledger = { version: 1, periods: [], viewing };
  assert.deepEqual(merge(ledger, readYaml(writeYaml(ledger))), ledger);
  assert.throws(() => watchPage(rows.slice(1)), /headings/);
  assert.throws(
    () => watchPage([...heading, cell(0, 640, "missing timestamp")]),
    /timestamps/,
  );
});

test("inactivity joins contiguous entitlements and breaks on a play or lapse", () => {
  const period = (start, end, service = "Hulu") => ({ service, start, end });
  const ledger = {
    periods: [
      period("2024-01-01", "2024-02-01"),
      { ...period("2024-02-01", "2024-03-01"), services: ["Hulu", "Disney+"] },
      period("2024-03-10", null),
    ],
    viewing: ["2024-01-02", "2024-01-02", "2024-02-03"].map((date) => ({
      service: "hulu",
      date,
    })),
  };
  const gaps = inactivity(ledger, Date.parse("2024-04-09"), 30);
  assert.deepEqual(
    gaps.map((g) => [
      g.name,
      new Date(g.start).toISOString().slice(0, 10),
      (g.end - g.start) / day,
    ]),
    [
      ["Hulu", "2024-01-03", 31],
      ["Hulu", "2024-03-10", 30],
    ],
  );
});
test("charge-based coverage prefers explicit dates then a plan's billing cycle", () => {
  const rows = ["mapsub", "billing-cycle", null].map((basis, i) => ({
    service: "A",
    start: "2024-02-01",
    end: ["2024-02-04", "2024-02-03", "2024-02-02"][i],
    estimate: basis ? { basis } : undefined,
  }));
  const spans = history(
    { periods: rows },
    Date.parse("2024-02-01"),
    Date.parse("2024-02-04"),
  );
  assert.deepEqual(
    spans.map((s) => [s.billingCycle, s.estimated]),
    [
      [[], []],
      [["a"], ["a"]],
      [[], ["a"]],
    ],
  );
});
