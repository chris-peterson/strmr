const months = "January February March April May June July August September October November December".split(" ");
const dateLine = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/;
const planLine = /^Fan \(Monthly\)$/;

export function isCrunchyrollHistory(text) {
  return text.split(/\r?\n/).some(line => planLine.test(line.trim()));
}

export function crunchyrollCharges(text) {
  const cells = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (cells.length % 5) throw new Error("Include all five lines of each Crunchyroll payment.");
  const charges = [];
  for (let i = 0; i < cells.length; i += 5) {
    const [date, plan, , total, status] = cells.slice(i, i + 5);
    const parts = dateLine.exec(date);
    if (!parts || !months.includes(parts[1])) throw new Error("Invalid Crunchyroll payment date.");
    if (!planLine.test(plan)) throw new Error("Expected a Crunchyroll Fan (Monthly) plan on " + date);
    if (status !== "Completed") throw new Error("Include only completed Crunchyroll payments. Check " + date);
    const amount = /^\$(\d+)\.(\d{2})$/.exec(total);
    if (!amount) throw new Error("Expected a USD charge total on " + date);
    const month = String(months.indexOf(parts[1]) + 1).padStart(2, "0");
    const start = [parts[3], month, parts[2].padStart(2, "0")].join("-");
    const amountMinor = Number(amount[1] + amount[2]);
    charges.push({
      id: ["crunchyroll", start, plan, amountMinor].join("/"),
      service: "Crunchyroll",
      chargedOn: start,
      start,
      source: "billing",
      currency: "USD",
      amountMinor,
      estimate: { basis: "billing-cycle", plan, cycle: "monthly" },
    });
  }
  return charges;
}
