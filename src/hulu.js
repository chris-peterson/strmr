// Labels from the English US Hulu charge-history table. A bundle is one bill
// with several entitlements, so its price stays on the original record.
const plans = new Map([
  ["Hulu Premium (Monthly)", ["Hulu"]],
  ["Disney+, Hulu Bundle Premium (Monthly)", ["Disney+", "Hulu"]],
  [
    "Disney+, Hulu, ESPN Select Bundle Premium (Monthly)",
    ["Disney+", "Hulu", "ESPN Select"],
  ],
  [
    "Disney+, Hulu, HBO Max Bundle (No Ads) (Monthly)",
    ["Disney+", "Hulu", "HBO Max"],
  ],
]);
const months =
  "January February March April May June July August September October November December".split(
    " ",
  );

export function huluCharges(text) {
  const cells = text
    .trim()
    .split(/[\t\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (cells.slice(0, 3).join("|") !== "Date|Description|Total") {
    throw new Error("Include Hulu's Date, Description and Total headers.");
  }
  if (cells.length < 6 || cells.length % 3)
    throw new Error("Incomplete Hulu charge row.");
  const charges = [];
  for (let i = 3; i < cells.length; i += 3) {
    const [date, plan, total] = cells.slice(i, i + 3);
    const parts = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(date);
    if (!parts || !months.includes(parts[1]))
      throw new Error("Invalid Hulu charge date: " + date);
    const start = [
      parts[3],
      String(months.indexOf(parts[1]) + 1).padStart(2, "0"),
      parts[2].padStart(2, "0"),
    ].join("-");
    const services = plans.get(plan);
    if (!services)
      throw new Error("Unrecognized Hulu plan on " + date + ": " + plan);
    if (!/^\$\d+\.\d{2}$/.test(total))
      throw new Error("Expected a USD charge total on " + date);
    const amountMinor = Number(total.slice(1).replace(".", ""));
    charges.push({
      id: ["hulu", start, plan, amountMinor].join("/"),
      service: "Hulu",
      chargedOn: start,
      start,
      source: "billing",
      amountMinor,
      currency: "USD",
      estimate: { basis: "billing-cycle", plan, cycle: "monthly" },
      ...(services.length > 1 ? { services: [...services] } : {}),
    });
  }
  return charges;
}
