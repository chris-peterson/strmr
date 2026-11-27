import Ajv from "ajv";
import { parse, stringify } from "yaml";
import Papa from "papaparse";
import schema from "../ledger.schema.json" with { type: "json" };

import catalog from "../catalog/mapsub.json" with { type: "json" };

import { netflixDate, netflixPayments } from "./netflix.js";

import { huluCharges } from "./hulu.js";

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
    if (
      p.estimate &&
      ((p.estimate.basis === "mapsub" &&
        (p.estimate.firstSeen > p.start || p.estimate.lastSeen < p.start)) ||
        p.end !== cycleEnd(p.start, p.estimate.cycle))
    ) {
      throw new Error(
        p.id + " has inconsistent price evidence or estimated end.",
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

export function readPaymentHistory(text) {
  if (/^Date\s+Description\s+Total(?:\s|$)/i.test(text.trim())) {
    const periods = huluCharges(text).map((p) => {
      if (!validDate(p.start))
        throw new Error("Invalid Hulu charge date: " + p.start);
      return { ...p, end: cycleEnd(p.start, p.estimate.cycle) };
    });
    return validate({ version: 1, periods });
  }
  return validate({ version: 1, periods: netflixPayments(text) });
}

export function readHistoryFile(text, filename) {
  if (/\.txt$/i.test(filename)) return readPaymentHistory(text);
  return /\.csv$/i.test(filename) ? readCsv(text) : readYaml(text);
}

export async function readHistoryInput(input, filename) {
  if (/\.pdf$/i.test(filename)) {
    const { huluReport } = await import("./hulu-report.js");
    return validate(await huluReport(input));
  }
  return readHistoryFile(input, filename);
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
        if (k === "services" && old.services && p.services) {
          return (
            old.services.length !== p.services.length ||
            old.services.some((v) => !p.services.includes(v))
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
    rows.set(p.id, p);
  }
  const result = { version: 1, periods: [...rows.values()] };
  if (ledger.viewing || incoming.viewing)
    result.viewing = distinctViewing([
      ...(ledger.viewing || []),
      ...(incoming.viewing || []),
    ]);
  return result;
}

// Consecutive boundaries divide the window into spans with constant membership.
export function history(ledger, start, end) {
  const changes = new Map([
    [start, []],
    [end, []],
  ]);
  for (const p of ledger.periods) {
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

// Prorate each finite charge across its covered calendar days before dividing
// by the number of imported views during that coverage.
export function pricePerView(ledger, from, until) {
  const groups = new Map();
  for (const period of ledger.periods) {
    if (period.end === null || period.amountMinor == null) continue;
    const start = Date.parse(period.start);
    const end = Date.parse(period.end);
    const duration = Math.min(until, end) - Math.max(from, start);
    if (duration <= 0) continue;
    const label = period.services
      ? period.services.join(" + ")
      : period.service;
    const key = JSON.stringify([serviceKey(label), period.currency]);
    if (!groups.has(key))
      groups.set(key, {
        service: label,
        currency: period.currency,
        costMinor: 0,
        views: 0,
        periods: [],
      });
    const group = groups.get(key);
    group.costMinor += period.amountMinor * (duration / (end - start));
    group.periods.push(period);
  }
  const results = [];
  for (const group of groups.values()) {
    const { periods, ...row } = group;

    for (const event of ledger.viewing || []) {
      const date = Date.parse(event.date);
      if (
        from <= date &&
        date < until &&
        periods.some(
          (p) =>
            p.start <= event.date &&
            event.date < p.end &&
            coveredServices(p).some(
              (name) => serviceKey(name) === serviceKey(event.service),
            ),
        )
      )
        row.views++;
    }
    results.push({
      ...row,
      perViewMinor: row.views ? row.costMinor / row.views : null,
    });
  }
  return results;
}

// An idle stretch must stay within one continuous coverage window. Deduplicate
// viewing days so repeated plays on a date have the same effect as one play.
export function inactivity(ledger, until, minimumDays) {
  const seen = new Map();
  for (const view of ledger.viewing || []) {
    const key = serviceKey(view.service);
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(Date.parse(view.date));
  }
  const coverage = new Map();
  for (const p of ledger.periods) {
    const start = Date.parse(p.start),
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
