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
  dailyServiceStats,
  historyYears,
  latestBillsByService,
  billingDaysLeft,
  inactivity,
  pricePerView,
  pricePerViewReport,
  monthlySpend,
  readCsv,
  readHistoryFile,
  readYaml,
  writeYaml,
  merge,
} from "../src/ledger.js";

test("monthly spend uses the charge month, all visible months and separate currencies", () => {
  const periods = [
    { start: "2025-12-30", chargedOn: "2026-01-02", amountMinor: 1200, currency: "USD", services: ["A", "B"] },
    { start: "2026-01-01", chargedOn: "2025-12-31", amountMinor: 900, currency: "USD" },
    { start: "2026-01-15", amountMinor: 600, currency: "EUR" },
    { start: "2026-03-09", amountMinor: 0, currency: "USD" },
    { start: "2026-03-11", amountMinor: 100, currency: "EUR" },
    { start: "2026-02-04" },
  ];
  const { months, averages } = monthlySpend(periods, Date.parse("2026-01-01"), Date.parse("2026-03-11"));
  assert.equal(months.get("2026-02").size, 0);
  assert.equal(months.get("2026-03").get("USD"), 0);
  assert.deepEqual(averages, [
    { currency: "EUR", totalMinor: 600, averageMinor: 200, values: [600, 0, 0] },
    { currency: "USD", totalMinor: 1200, averageMinor: 400, values: [1200, 0, 0] },
  ]);
  assert.deepEqual(monthlySpend([], Date.parse("2026-01-01"), Date.parse("2026-02-01")).averages, []);
});

test("billing corrections survive reimport and control coverage and spending independently", () => {
  const original = readCsv("service,date,cycle,amountMinor,currency\nA,2025-09-18,monthly,2000,USD\nA,2025-10-18,monthly,2100,USD");
  const adjusted = structuredClone(original);
  adjusted.periods[0].lastCoveredOn = "2025-09-30";
  adjusted.periods[1].refunded = true;
  const ledger = merge(merge(original, adjusted), original);
  assert.deepEqual(ledger, adjusted);
  const from = Date.parse("2025-09-01"), until = Date.parse("2025-11-01");
  assert.equal(latestBillsByService(ledger.periods, until).get("a").end, "2025-10-01");
  const report = pricePerViewReport(ledger, from, until);
  assert.equal(report.coverage[0].pricedDays, 13);
  assert.equal(report.totals[0].costMinor, 2000);
  assert.deepEqual(monthlySpend(ledger.periods, from, until).averages[0].values, [2000, 0]);
  assert.ok(history(ledger, Date.parse("2025-10-01"), until).every(span => !span.services.length));
});

const csv =
  "id,service,start,end\na,A,2024-02-28,2024-03-01\nb,a,2024-02-29,2024-03-01\nc,B,2024-02-29,2024-03-01\nd,C,2024-03-01,";
test("a mixed bundle counts once toward spend and only its video service counts toward coverage", () => {
  const from = Date.parse("2026-10-01"), until = Date.parse("2026-11-01");
  const ledger = readCsv("service,date,cycle,amountMinor,currency\nApple TV,2026-10-01,monthly,3070,USD");
  ledger.periods[0].nonVideoServices = ["Apple Music", "Apple Arcade", "iCloud"];
  ledger.viewing = [{ service: "Apple TV", date: "2026-10-10", title: "Episode" }];
  const saved = merge(ledger, readYaml(writeYaml(ledger)));
  assert.equal(saved.periods.length, 1);
  assert.deepEqual(history(saved, from, until)[0].services, ["apple tv"]);
  assert.equal(monthlySpend(saved.periods, from, until).averages[0].averageMinor, 3070);
  const report = pricePerViewReport(saved, from, until);
  assert.deepEqual(report.totals, []);
  assert.deepEqual(report.unallocatedServices, ["Apple TV"]);
  assert.deepEqual(report.coverage, [{ service: "Apple TV", pricedDays: 0, views: 1, matched: 0 }]);
});

test("year buttons include YTD, viewing years and years with covered days", () => {
  const today = Date.parse("2026-06-15");
  const ledger = {
    periods: [
      { start: "2019-12-31", end: "2022-01-01" },
      { start: "2025-12-31", end: null },
      { start: "2027-01-01", end: null },
    ],
    viewing: [{ date: "2016-05-03" }, { date: "2028-01-01" }],
  };
  assert.deepEqual(historyYears(ledger, today), [2026, 2025, 2021, 2020, 2019, 2016]);
  assert.deepEqual(historyYears({ periods: [] }, today), [2026]);
});

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
  assert.deepEqual(dailyServiceStats(spans), { average: 1, median: 1 });
});
test("daily service stats weight by days, include uncovered days, and average the two middle days", () => {
  const periods = [{ service: "A", services: ["A", "B", "C"], start: "2026-01-03", end: "2026-01-05" },
    { service: "B", start: "2026-01-03", end: "2026-01-04" }];
  const from = Date.parse("2026-01-01");
  const stats = (n) => dailyServiceStats(history({ periods }, from, from + n * day));
  assert.deepEqual(stats(4), { average: 1.5, median: 1.5 });
  assert.deepEqual(stats(5), { average: 1.2, median: 0 });
  assert.deepEqual(stats(1), { average: 0, median: 0 });
});
test("monthly service trends clip spans at month boundaries and at the last visible day", () => {
  const from = Date.parse("2024-01-01"), feb = Date.parse("2024-02-01"), end = Date.parse("2024-02-04");
  const spans = history({ periods: [{ service: "A", start: "2024-01-30", end: "2024-02-02" }] }, from, end);
  assert.deepEqual(dailyServiceStats(spans, from, feb), { average: 2 / 31, median: 0 });
  assert.deepEqual(dailyServiceStats(spans, feb, end), { average: 1 / 3, median: 0 });
  assert.equal(dailyServiceStats(spans).average, 3 / 34);
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

test("monthly PayPal activity keeps gaps, handles year rollover and rejects ambiguous rows", () => {
  const text = "Last week\nPARAMOUNT+\n−$2.55\nJan 5 . Payment\nDec 2024\nPARAMOUNT+\n-$3.00\nDec 3 · Payment";
  const read = (s) => readHistoryFile(s, "activity.txt", { monthlyPayPal: true });
  const ledger = read(text);
  assert.deepEqual(ledger.periods.map((p) => [p.chargedOn, p.end, p.amountMinor]), [
    ["2025-01-05", "2025-02-05", 255], ["2024-12-03", "2025-01-03", 300],
  ]);
  assert.deepEqual(merge(ledger, read(text)), ledger);
  assert.throws(() => readHistoryFile(text, "activity.txt"), /monthly/);
  for (const bad of [text.replace("Dec 2024", "Jul 2024"), text.replace("Dec 3 ·", "Dec 32 ·"),
    text.replace("-$3.00", "+$3.00"), text.replace("Dec 3 · Payment", "Dec 3 · Refund")])
    assert.throws(() => read(bad));
});

test("billing days left includes the reference day and stops at expiry", () => {
  const bill = { end: "2025-01-02" };
  assert.equal(billingDaysLeft(bill, Date.parse("2024-12-31")), 2);
  assert.equal(billingDaysLeft(bill, Date.parse("2025-01-01")), 1);
  assert.equal(billingDaysLeft(bill, Date.parse("2025-01-02")), 0);
  assert.equal(billingDaysLeft(bill, Date.parse("2025-01-03")), 0);
  assert.equal(billingDaysLeft({ end: null }, Date.parse("2025-01-01")), null);
});

test("latest bill per service respects the cutoff, shared bundles and unknown ends", () => {
  const bundle = { service: "A", services: ["A", "B"], source: "billing",
    start: "2024-12-20", end: "2025-01-20", chargedOn: "2024-12-20" };
  const direct = { service: "a", source: "billing", start: "2024-12-28", end: null };
  const future = { ...direct, chargedOn: "2025-01-01", end: "2025-01-28" };
  const manual = { service: "B", source: "manual", start: "2024-12-30", end: null };
  const latest = latestBillsByService([direct, future, bundle, manual], Date.parse("2025-01-01"));
  assert.equal(latest.get("a"), direct);
  assert.equal(latest.get("b"), bundle);
});

test("Peacock payment paste preserves zero totals and allocates a monthly bundle once", () => {
  const raw = "Premium Plus Monthly\n\n02/01/2024\n\nVISA\n$0.00\n\n" +
    "Apple TV and Peacock Premium Plus\n01/31/2024\nVISA\n$10.10";
  const ledger = readHistoryFile(raw, "peacock.txt");
  const [zero, bundle] = ledger.periods;
  assert.equal(zero.amountMinor, 0);
  assert.deepEqual(bundle.services, ["Peacock", "Apple TV"]);
  assert.equal(bundle.end, "2024-02-29");
  assert.equal(bundle.estimate.basis, "billing-cycle");
  assert.equal(bundle.chargedOn, "2024-01-31");
  assert.equal(bundle.currency, "USD");
  assert.equal(writeYaml(ledger).includes("VISA"), false);
  assert.deepEqual(merge(ledger, readHistoryFile(raw, "again.txt")), ledger);
  assert.equal(pricePerView(ledger, -Infinity, Infinity).reduce((n, r) => n + r.costMinor, 0), 1010);
  for (const bad of [raw.replace("01/31", "02/31"), raw.replace("$10.10", "-$10.10"), raw + "\nExtra row"])
    assert.throws(() => readHistoryFile(bad, "peacock.txt"));
});

test("Crunchyroll imports completed monthly payments without card details or duplicate charges", () => {
  const text = "January 31, 2024\n\nFan (Monthly)\nVISA *********0000\n\n$9.99\nCompleted";
  const ledger = readHistoryFile(text, "payments.txt");
  const [bill] = ledger.periods;
  assert.equal(bill.service, "Crunchyroll");
  assert.equal(bill.chargedOn, "2024-01-31");
  assert.equal(bill.end, "2024-02-29");
  assert.equal(bill.amountMinor, 999);
  assert.equal(bill.currency, "USD");
  assert.equal(bill.estimate.plan, "Fan (Monthly)");
  assert.doesNotMatch(writeYaml(ledger), /0000|VISA/);
  assert.deepEqual(merge(ledger, readHistoryFile(text, "again.txt")), ledger);
  for (const invalid of [text.replace("Completed", "Pending"), text.replace("January", "February"), text.replace("$9.99", "-$9.99")])
    assert.throws(() => readHistoryFile(invalid, "payments.txt"));
});

test("Peacock viewing CSV merges repeat imports and preserves plays with missing bills", () => {
  const input = "service,date,title,lastPlayedAt,series,season\n" +
    "Peacock,2025-05-03,Episode,2025-05-03T12:00:00,Show,2\n" +
    "Peacock,2025-05-03,Episode,2025-05-03T13:00:00,Show,2\n" +
    "Peacock,2025-06-01,Movie,,,";
  const views = readHistoryFile(input, "watch.csv");
  assert.equal(views.periods.length, 0);
  assert.deepEqual(views.viewing[0], {
    service: "Peacock", date: "2025-05-03", title: "Episode",
    lastPlayedAt: "2025-05-03T12:00:00", series: "Show", season: "2",
  });
  const bills = readCsv("service,date,cycle,amountMinor,currency\nPeacock,2025-05-01,monthly,600,USD");
  const ledger = merge(bills, views);
  assert.deepEqual(merge(ledger, views), ledger);
  const report = pricePerViewReport(ledger, Date.parse("2025-01-01"), Date.parse("2026-01-01"));
  assert.deepEqual(report.coverage, [{ service: "Peacock", pricedDays: 31, views: 3, matched: 2 }]);
  assert.equal(report.rows[0].perViewMinor, 300);
  assert.throws(() => readCsv(input.replace("2025-06-01", "2025-06-31")), /date/);
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

test("billing gaps respect the window, bundle membership and partial or absent charges", () => {
  const ledger = readCsv(
    "id,service,start,end,amountMinor,currency\n" +
    "bundle,Hulu,2024-02-28,2024-03-02,300,USD\n" +
    "direct,Disney+,2024-03-01,2024-03-02,0,USD\n" +
    "ongoing,Netflix,2024-02-01,,500,USD\n" +
    "unknown,Hulu,2024-03-02,2024-03-03,,",
  );
  ledger.periods[0].services = ["Hulu", "Disney+"];
  ledger.viewing = [
    ["Hulu", "2024-02-28"], ["Hulu", "2024-02-29"],
    ["disney+", "2024-03-01"], ["Hulu", "2024-03-02"],
    ["Netflix", "2024-03-01"], ["Other", "2024-03-01"],
    ["Hulu", "2024-03-03"],
  ].map(([service, date]) => ({ service, date }));
  const { rows, coverage } = pricePerViewReport(
    ledger, Date.parse("2024-02-29"), Date.parse("2024-03-03"),
  );
  assert.deepEqual(coverage, [
    { service: "Hulu", pricedDays: 2, views: 2, matched: 1 },
    { service: "Disney+", pricedDays: 2, views: 1, matched: 1 },
    { service: "Netflix", pricedDays: 0, views: 1, matched: 0 },
    { service: "Other", pricedDays: 0, views: 1, matched: 0 },
  ]);
  assert.deepEqual(rows.map((r) => r.perViewMinor), [100, 0]);

  const next = pricePerViewReport(ledger, Date.parse("2024-03-02"), Date.parse("2024-03-03"));
  assert.equal(next.rows.length, 0);
  assert.equal(next.coverage.find((r) => r.service === "Hulu").matched, 0);
});

test("currency totals count an overlapping view once and include bills with no views", () => {
  const periods = [
    { service: "A", services: ["A", "B"], amountMinor: 600, currency: "USD" },
    { service: "B", amountMinor: 300, currency: "USD" },
    { service: "C", amountMinor: 100, currency: "USD" },
    { service: "B", amountMinor: 250, currency: "CAD" },
    { service: "C", amountMinor: 200, currency: "GBP" },
  ].map((p) => ({ ...p, start: "2025-01-01", end: "2025-01-03" }));
  const viewing = ["B", "B", "Other"].map((service, i) => ({
    service, date: "2025-01-02", title: String(i),
  }));
  const report = pricePerViewReport({ periods, viewing }, Date.parse("2025-01-02"), Date.parse("2025-01-03"));
  assert.deepEqual(report.totals, [
    { currency: "USD", costMinor: 500, views: 2, perViewMinor: 250 },
    { currency: "CAD", costMinor: 125, views: 2, perViewMinor: 62.5 },
    { currency: "GBP", costMinor: 100, views: 0, perViewMinor: null },
  ]);
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
test("inactivity counts only idle days inside the selected window", () => {
  const ledger = {
    periods: [{ service: "Hulu", start: "2023-11-01", end: null }],
    viewing: [{ service: "Hulu", date: "2023-11-01" }],
  };
  const start = Date.parse("2024-01-01");
  const end = Date.parse("2024-01-31");
  assert.deepEqual(inactivity(ledger, end, 30, start), [
    { name: "Hulu", start, end },
  ]);
  assert.deepEqual(inactivity(ledger, end - day, 30, start), []);
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
