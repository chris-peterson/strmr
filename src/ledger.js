import Ajv from "ajv";
import { parse, stringify } from "yaml";
import Papa from "papaparse";
import schema from "../ledger.schema.json" with { type: "json" };

import catalog from "../catalog/mapsub.json" with { type: "json" };

import { netflixDate, netflixPayments } from "./netflix.js";

import { huluCharges } from "./hulu.js";
import { crunchyrollCharges, isCrunchyrollHistory } from "./crunchyroll.js";
import { isPeacockHistory, peacockCharges } from "./peacock.js";

import { paramountPayments } from "./paramount.js";

const ajv = new Ajv();
export const day = 86400000;
export const iso = (time) => new Date(time).toISOString().slice(0, 10);
function validDate(value) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && iso(time) === value;
}
ajv.addFormat("date", validDate);
const conforms = ajv.compile(schema);
export function validate(ledger) {
  if (!conforms(ledger))
    throw new Error(ajv.errorsText(conforms.errors, { dataVar: "ledger" }));
  const ids = new Set();
  for (const p of ledger.periods) {
    if (ids.has(p.id)) throw new Error("Duplicate record ID: " + p.id);
    if (p.end !== null && p.end <= p.start)
      throw new Error(p.id + " must end after its start.");
    if (p.lastCoveredOn && (p.lastCoveredOn < p.start ||
        (p.end && p.lastCoveredOn >= p.end) || p.refunded))
      throw new Error(p.id + " has an invalid final covered day.");
    if (
      p.estimate &&
      ((p.estimate.basis === "mapsub" &&
        (p.estimate.firstSeen > p.start || p.estimate.lastSeen < p.start)) ||
        p.end !== cycleEnd(p.start, p.estimate.cycle))
    ) {
      throw new Error(
        p.id + " has inconsistent price evidence or billing cycle end date.",
      );
    }
    if (
      p.subtotalMinor != null &&
      p.subtotalMinor + p.taxMinor !== p.amountMinor
    ) {
      throw new Error("Subtotal and tax must equal the total for " + p.id);
    }
    if (p.services) {
      const names = new Set(p.services.map(serviceKey));
      if (names.size !== p.services.length || !names.has(serviceKey(p.service)))
        throw new Error("Invalid bundle services for " + p.id);
    }
    ids.add(p.id);
  }
  for (const event of ledger.viewing || []) {
    if (event.lastPlayedAt && !event.lastPlayedAt.startsWith(event.date + "T"))
      throw new Error("Playback timestamp must match viewing date.");
  }
  return ledger;
}
export const readYaml = (text) => validate(parse(text));
export const writeYaml = (ledger) => stringify(validate(ledger));
export const empty = () => ({ version: 1, periods: [] });
export const serviceKey = (name) => name.trim().toLowerCase();

function cycleEnd(start, cycle) {
  const date = new Date(start);
  const month = date.getUTCMonth() + (cycle === "monthly" ? 1 : 12);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), month + 1, 0),
  ).getUTCDate();
  return iso(
    Date.UTC(
      date.getUTCFullYear(),
      month,
      Math.min(lastDay, date.getUTCDate()),
    ),
  );
}

function estimateCharge(period) {
  let name = serviceKey(period.service);
  if (name === "apple tv+") name = "apple tv";
  if (name === "netflix" && period.currency === "GBP") name = "netflix uk";
  const matches = catalog.prices.filter(
    (price) =>
      serviceKey(price.service) === name &&
      price.currency === period.currency &&
      price.amountMinor === period.amountMinor &&
      price.firstSeen <= period.start &&
      period.start <= price.lastSeen,
  );
  if (matches.length !== 1) {
    const reason = matches.length
      ? "Multiple MapSub prices match"
      : "No observed MapSub price matches";
    throw new Error(
      reason +
        " for " +
        period.id +
        " on " +
        period.start +
        ". Supply its billing cycle or coverage dates.",
    );
  }
  const { plan, cycle, firstSeen, lastSeen, evidenceUrl } = matches[0];
  return { basis: "mapsub", plan, cycle, firstSeen, lastSeen, evidenceUrl };
}

export const coveredServices = (period) => period.services ?? [period.service];

export function* coveredPeriods(periods) {
  for (const period of periods) {
    if (period.refunded) continue;
    if (period.lastCoveredOn) {
      yield { ...period, end: iso(Date.parse(period.lastCoveredOn) + day), estimate: undefined };
    } else yield period;
  }
}

export function readPaymentHistory(text, { monthlyPayPal = false } = {}) {
  let charges;
  if (monthlyPayPal) charges = paramountPayments(text);
  else if (/^\s*PARAMOUNT\+\s*$/im.test(text))
    throw new Error("For a confirmed monthly plan, choose Paramount+ monthly via PayPal or use the CLI --paypal-monthly option.");
  else if (isPeacockHistory(text)) charges = peacockCharges(text);
  else if (/^Date\s+Description\s+Total(?:\s|$)/i.test(text.trim())) charges = huluCharges(text);
  else if (isCrunchyrollHistory(text)) charges = crunchyrollCharges(text);
  else return validate({ version: 1, periods: netflixPayments(text) });

  const periods = charges.map((p) => {
    if (!validDate(p.start))
      throw new Error("Invalid " + p.service + " charge date: " + p.start);
    return { ...p, end: cycleEnd(p.start, p.estimate.cycle) };
  });
  return validate({ version: 1, periods });
}

export function readHistoryFile(text, filename, options) {
  if (/\.txt$/i.test(filename)) return readPaymentHistory(text, options);
  return /\.csv$/i.test(filename) ? readCsv(text) : readYaml(text);
}

export async function readHistoryInput(input, filename, options) {
  if (/\.pdf$/i.test(filename)) {
    const { huluReport } = await import("./hulu-report.js");
    return validate(await huluReport(input));
  }
  return readHistoryFile(input, filename, options);
}

export const viewingKey = (event) =>
  JSON.stringify([
    serviceKey(event.service),
    event.date,
    event.title,
    event.lastPlayedAt,
    event.series,
    event.season,
  ]);

function distinctViewing(rows) {
  const events = new Map();
  for (const event of rows) {
    events.set(viewingKey(event), event);
  }
  return [...events.values()];
}

export function readCsv(text) {
  const { data, errors, meta } = Papa.parse(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (key) => key.trim(),
  });
  if (errors.length) throw new Error(errors[0].message);
  if (
    meta.fields?.includes("Title") &&
    meta.fields.includes("Date") &&
    !meta.fields.includes("service")
  ) {
    return validate({
      version: 1,
      periods: [],
      viewing: distinctViewing(
        data.map((row) => ({
          service: "Netflix",
          date: netflixDate(row.Date.trim()),
          title: row.Title,
        })),
      ),
    });
  }
  const fields = new Set(meta.fields);
  if (["service", "date", "title"].every((key) => fields.has(key)) &&
      !["start", "end", "cycle", "amountMinor", "currency"].some((key) => fields.has(key))) {
    const viewing = data.map((row) => {
      const event = {
        service: row.service.trim(),
        date: row.date.trim(),
        title: row.title.trim(),
      };
      for (const field of ["lastPlayedAt", "series", "season"]) {
        if (row[field]?.trim()) event[field] = row[field].trim();
      }
      return event;
    });
    return validate({ version: 1, periods: [], viewing: distinctViewing(viewing) });
  }
  const charges =
    !meta.fields?.includes("start") && meta.fields?.includes("date");
  const required = charges ? ["service", "date"] : ["service", "start", "end"];
  for (const field of required) {
    if (!meta.fields?.includes(field))
      throw new Error("Missing CSV column: " + field);
  }
  return validate({
    version: 1,
    periods: data.map((row) => {
      const start = (charges ? row.date : row.start).trim();
      const p = {
        id: row.id?.trim() || serviceKey(row.service) + "/" + start,
        service: row.service.trim(),
        start,
        end: charges ? null : row.end.trim() || null,
        source: row.source?.trim() || "billing",
      };
      if (row.amountMinor?.trim()) {
        if (!/^\d+$/.test(row.amountMinor.trim()))
          throw new Error("amountMinor requires a nonnegative integer.");
        p.amountMinor = Number(row.amountMinor);
      }
      if (row.currency?.trim()) p.currency = row.currency.trim();
      if (charges) {
        if (!validDate(start)) throw new Error("Invalid charge date: " + start);
        let cycle = row.cycle?.trim();
        if (!cycle) {
          if (p.amountMinor == null || !p.currency)
            throw new Error(
              "Supply cycle or both amountMinor and currency for " + p.id,
            );
          p.estimate = estimateCharge(p);
          cycle = p.estimate.cycle;
        }
        if (!["monthly", "annual"].includes(cycle))
          throw new Error("Billing cycle must be monthly or annual.");
        p.end = cycleEnd(start, cycle);
      }
      return p;
    }),
  });
}

export function merge(ledger, incoming) {
  const rows = new Map(validate(ledger).periods.map((p) => [p.id, p]));
  for (const p of validate(incoming).periods) {
    const old = rows.get(p.id);
    if (
      old &&
      Object.keys({ ...old, ...p }).some((k) => {
        if ((k === "refunded" || k === "lastCoveredOn") && (!old[k] || !p[k])) return false;
        if ((k === "services" || k === "nonVideoServices") && old[k] && p[k]) {
          return (
            old[k].length !== p[k].length ||
            old[k].some((v) => !p[k].includes(v))
          );
        }
        if (k === "estimate" && old.estimate && p.estimate) {
          return Object.keys(p.estimate).some(
            (field) => old.estimate[field] !== p.estimate[field],
          );
        }
        return old[k] !== p[k];
      })
    ) {
      throw new Error("Conflicting record ID: " + p.id);
    }
    rows.set(p.id, old ? { ...old, ...p } : p);
  }
  const result = { version: 1, periods: [...rows.values()] };
  if (ledger.viewing || incoming.viewing)
    result.viewing = distinctViewing([
      ...(ledger.viewing || []),
      ...(incoming.viewing || []),
    ]);
  return validate(result);
}

export function historyYears(ledger, today) {
  const current = new Date(today).getUTCFullYear();
  const years = new Set([current]);
  for (const view of ledger.viewing || []) {
    const year = Number(view.date.slice(0, 4));
    if (year < current) years.add(year);
  }
  for (const period of ledger.periods) {
    const year = Number((period.chargedOn ?? period.start).slice(0, 4));
    if (period.amountMinor != null && year < current) years.add(year);
  }
  for (const period of coveredPeriods(ledger.periods)) {
    const lastDay = period.end ? Math.min(today, Date.parse(period.end) - day) : today;
    const lastYear = new Date(lastDay).getUTCFullYear();
    for (let year = Number(period.start.slice(0, 4)); year <= lastYear; year++)
      years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

export function billingDaysLeft(bill, asOf) {
  if (!bill?.end) return null;
  return Math.max(0, (Date.parse(bill.end) - asOf) / day);
}

// A bundle's bill also supplies the covered-through date for its members.
export function latestBillsByService(periods, until) {
  const latest = new Map();
  for (const p of coveredPeriods(periods)) {
    if (p.source !== "billing" && !p.chargedOn && !p.estimate && p.amountMinor == null)
      continue;
    const date = p.chargedOn ?? p.start;
    if (Date.parse(date) >= until) continue;
    for (const name of coveredServices(p)) {
      const key = serviceKey(name);
      const prior = latest.get(key);
      const priorDate = prior?.chargedOn ?? prior?.start;
      if (!prior || date > priorDate ||
          (date === priorDate && (p.end ?? "") > (prior.end ?? "")))
        latest.set(key, p);
    }
  }
  return latest;
}

// Consecutive boundaries divide the window into spans with constant membership.
export function history(ledger, start, end) {
  const changes = new Map([
    [start, []],
    [end, []],
  ]);
  for (const p of coveredPeriods(ledger.periods)) {
    const from = Math.max(start, Date.parse(p.start));
    const to = Math.min(end, p.end ? Date.parse(p.end) : end);
    if (to <= from) continue;
    for (const [time, delta] of [
      [from, 1],
      [to, -1],
    ]) {
      if (!changes.has(time)) changes.set(time, []);
      for (const name of coveredServices(p)) {
        changes.get(time).push([serviceKey(name), delta, p.estimate?.basis]);
      }
    }
  }
  const times = [...changes.keys()].sort((a, b) => a - b);
  const counts = new Map();
  const reportedCounts = new Map();
  const cycleCounts = new Map();
  return times.slice(0, -1).map((time, i) => {
    for (const [name, delta, basis] of changes.get(time)) {
      if (basis === "billing-cycle")
        cycleCounts.set(name, (cycleCounts.get(name) || 0) + delta);
      if (!basis)
        reportedCounts.set(name, (reportedCounts.get(name) || 0) + delta);
      const count = (counts.get(name) || 0) + delta;
      if (count) counts.set(name, count);
      else counts.delete(name);
    }
    const services = [...counts.keys()];
    return {
      start: time,
      end: times[i + 1],
      services,
      estimated: services.filter((name) => !reportedCounts.get(name)),
      billingCycle: services.filter(
        (name) => !reportedCounts.get(name) && cycleCounts.get(name) > 0,
      ),
    };
  });
}

export function dailyServiceStats(spans, from = -Infinity, until = Infinity) {
  const counts = [];
  for (const { start, end, services } of spans) {
    const stop = Math.min(end, until);
    for (let date = Math.max(start, from); date < stop; date += day) counts.push(services.length);
  }
  if (!counts.length) return null;
  counts.sort((a, b) => a - b);
  const middle = Math.floor(counts.length / 2);
  return {
    average: counts.reduce((sum, count) => sum + count, 0) / counts.length,
    median: counts.length % 2 ? counts[middle] : (counts[middle - 1] + counts[middle]) / 2,
  };
}

export const amountPaidMinor = period => period.refunded ? 0 : period.amountMinor;

export function monthlySpend(periods, from, until) {
  const months = new Map();
  const date = new Date(from);
  date.setUTCDate(1);
  while (date.getTime() < until) {
    months.set(iso(date).slice(0, 7), new Map());
    date.setUTCMonth(date.getUTCMonth() + 1);
  }
  const currencies = new Set();
  const first = iso(from), end = iso(until);
  for (const period of periods) {
    const charged = period.chargedOn ?? period.start;
    if (period.amountMinor == null || charged < first || charged >= end) continue;
    const totals = months.get(charged.slice(0, 7));
    const paid = amountPaidMinor(period);
    totals.set(period.currency, (totals.get(period.currency) ?? 0) + paid);
    currencies.add(period.currency);
  }
  const averages = [...currencies].sort().map((currency) => {
    const values = Array.from(months.values(), (totals) => totals.get(currency) ?? 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    return { currency, totalMinor: total, averageMinor: total / values.length, values };
  });
  return { months, averages };
}

// Prorate each finite charge across its covered calendar days before dividing
// by the number of imported views during that coverage.
export function pricePerViewReport(ledger, from, until) {
  const groups = new Map();
  const totals = new Map();
  const services = new Map();
  function serviceCoverage(name) {
    const key = serviceKey(name);
    if (!services.has(key))
      services.set(key, { service: name.trim(), pricedDays: 0, views: 0, matched: 0 });
    return services.get(key);
  }

  const priced = [];
  const unallocatedBundles = new Map();
  for (const period of coveredPeriods(ledger.periods)) {
    const start = Date.parse(period.start);
    const end = period.end ? Date.parse(period.end) : until;
    const duration = Math.min(until, end) - Math.max(from, start);
    if (duration <= 0) continue;
    for (const name of coveredServices(period)) serviceCoverage(name);
    if (period.nonVideoServices) {
      const video = coveredServices(period);
      const plan = period.estimate?.plan ?? video.join(" + ") + " bundle";
      const bundle = { plan, video, other: period.nonVideoServices };
      unallocatedBundles.set(JSON.stringify(bundle), bundle);
      continue;
    }
    if (!period.end || period.amountMinor == null) continue;
    priced.push(period);

    const label = period.services ? period.services.join(" + ") : period.service;
    const members = coveredServices(period);
    const key = JSON.stringify([members.map(serviceKey).sort(), period.currency]);
    if (!groups.has(key))
      groups.set(key, {
        service: label,
        members,
        currency: period.currency,
        costMinor: 0,
        views: 0,
        periods: [],
      });
    const group = groups.get(key);
    const allocated = period.amountMinor * (duration / (end - start));
    group.costMinor += allocated;
    if (!totals.has(period.currency))
      totals.set(period.currency, { currency: period.currency, costMinor: 0, views: 0 });
    totals.get(period.currency).costMinor += allocated;
    group.periods.push(period);
  }

  // Count each service-day once, including overlapping direct and bundle bills.
  for (const span of history({ periods: priced }, from, until)) {
    for (const key of span.services)
      services.get(key).pricedDays += (span.end - span.start) / day;
  }
  for (const event of ledger.viewing || []) {
    const date = Date.parse(event.date);
    if (date < from || date >= until) continue;
    const coverage = serviceCoverage(event.service);
    coverage.views++;
    const key = serviceKey(event.service);
    const matchedCurrencies = new Set();
    for (const group of groups.values()) {
      if (group.periods.some((p) =>
        p.start <= event.date && event.date < p.end &&
        coveredServices(p).some((name) => serviceKey(name) === key)
      )) {
        group.views++;
        matchedCurrencies.add(group.currency);
      }
    }
    if (matchedCurrencies.size) coverage.matched++;
    for (const currency of matchedCurrencies) totals.get(currency).views++;
  }
  const rows = Array.from(groups.values(), ({ periods, ...row }) => ({
    ...row,
    perViewMinor: row.views ? row.costMinor / row.views : null,
  }));
  const currencyTotals = Array.from(totals.values(), (total) => ({
    ...total,
    perViewMinor: total.views ? total.costMinor / total.views : null,
  }));
  const bundles = [...unallocatedBundles.values()];
  return { rows, coverage: [...services.values()], totals: currencyTotals,
    unallocatedServices: [...new Set(bundles.flatMap(bundle => bundle.video))], unallocatedBundles: bundles };
}

export function pricePerView(ledger, from, until) {
  return pricePerViewReport(ledger, from, until).rows;
}

// An idle stretch must stay within one continuous coverage window. Deduplicate
// viewing days so repeated plays on a date have the same effect as one play.
export function inactivity(ledger, until, minimumDays, from = -Infinity) {
  const seen = new Map();
  for (const view of ledger.viewing || []) {
    const key = serviceKey(view.service);
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(Date.parse(view.date));
  }
  const coverage = new Map();
  for (const p of coveredPeriods(ledger.periods)) {
    const start = Math.max(from, Date.parse(p.start)),
      end = Math.min(until, p.end ? Date.parse(p.end) : until);
    if (start >= end) continue;
    for (const name of coveredServices(p)) {
      const key = serviceKey(name);
      if (!coverage.has(key)) coverage.set(key, { name, windows: [] });
      coverage.get(key).windows.push({ start, end });
    }
  }
  const gaps = [];
  for (const [key, { name, windows }] of coverage) {
    if (!seen.has(key)) continue;
    const plays = [...seen.get(key)].sort((a, b) => a - b);
    const continuous = [];
    for (const window of windows.sort((a, b) => a.start - b.start)) {
      const prior = continuous.at(-1);
      if (prior && prior.end >= window.start)
        prior.end = Math.max(prior.end, window.end);
      else continuous.push({ ...window });
    }
    let i = 0;
    for (const window of continuous) {
      let cursor = Math.max(window.start, plays[0]);
      while (i < plays.length && plays[i] < window.start) i++;
      while (i < plays.length && plays[i] < window.end) {
        const play = plays[i++];
        if ((play - cursor) / day >= minimumDays)
          gaps.push({ name, start: cursor, end: play });
        cursor = play + day;
      }
      if ((window.end - cursor) / day >= minimumDays)
        gaps.push({ name, start: cursor, end: window.end });
    }
  }
  return gaps.sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) ||
      b.end - a.end ||
      a.name.localeCompare(b.name),
  );
}
