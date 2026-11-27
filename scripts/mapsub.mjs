// Rebuild the offline streaming subset from MapSub's CC BY 4.0 all.csv.
import { readFile, writeFile, rename } from "node:fs/promises";
import Papa from "papaparse";
const source = "https://mapsub.com/data/price-history/all.csv";
const services = new Set([
  "Netflix",
  "Netflix UK",
  "Hulu",
  "Disney+",
  "HBO Max",
  "Apple TV",
  "Prime Video",
  "Crunchyroll",
  "Paramount+",
  "Peacock",
]);
const response = process.argv[2] ? null : await fetch(source);
if (response && !response.ok)
  throw new Error("MapSub download failed: " + response.status);
const csv = response
  ? await response.text()
  : await readFile(process.argv[2], "utf8");
const { data, errors } = Papa.parse(csv, {
  header: true,
  skipEmptyLines: "greedy",
});
if (errors.length) throw new Error(errors[0].message);
const prices = [];
for (const row of data) {
  if (
    !services.has(row.service) ||
    /^Extra member/i.test(row.plan) ||
    (row.service === "Prime Video" && row.plan === "Ad-free")
  )
    continue;
  if (!["month", "year"].includes(row.per)) continue;
  if (
    !row.plan ||
    !/^\d+(\.\d{1,2})?$/.test(row.price) ||
    !["USD", "GBP"].includes(row.currency) ||
    ![row.first_seen, row.last_seen].every(
      (s) =>
        /^\d{4}-\d{2}-\d{2}$/.test(s) &&
        new Date(s).toISOString().slice(0, 10) === s,
    ) ||
    row.first_seen > row.last_seen ||
    !/^https?:\/\//.test(row.evidence_url)
  )
    throw new Error("Unexpected MapSub row: " + row.service + " " + row.plan);
  prices.push({
    service: row.service,
    currency: row.currency,
    amountMinor: Math.round(Number(row.price) * 100),
    plan: row.plan,
    cycle: row.per === "year" ? "annual" : "monthly",
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    evidenceUrl: row.evidence_url,
  });
}
for (const service of services)
  if (!prices.some((row) => row.service === service))
    throw new Error("Missing service: " + service);
const output = new URL("../catalog/mapsub.json", import.meta.url);
const temp = new URL(output.href + "." + process.pid + ".tmp");
await writeFile(
  temp,
  JSON.stringify(
    {
      publisher: "MapSub",
      source,
      license: "https://creativecommons.org/licenses/by/4.0/",
      prices,
    },
    null,
    2,
  ) + "\n",
);
await rename(temp, output);
console.log("Saved " + prices.length + " observed prices.");
