// The US payment-history page lists plan, date, payment method and total.
const plans = new Map([
  ["Premium Plus Monthly", ["Peacock"]],
  ["Apple TV and Peacock Premium Plus", ["Peacock", "Apple TV"]],
]);

export function isPeacockHistory(text) {
  return plans.has(text.trim().split(/[\t\r\n]/, 1)[0].trim());
}

export function peacockCharges(text) {
  const cells = text.trim().split(/[\t\r\n]+/).map((s) => s.trim()).filter(Boolean);
  if (cells.length % 4) throw new Error("Incomplete Peacock payment row.");
  const charges = [];
  for (let i = 0; i < cells.length; i += 4) {
    const [plan, date, , total] = cells.slice(i, i + 4);
    const services = plans.get(plan);
    if (!services) throw new Error("Unrecognized Peacock plan: " + plan);
    const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
    if (!parts) throw new Error("Invalid Peacock charge date: " + date);
    const [, month, dom, year] = parts;
    const start = [year, month.padStart(2, "0"), dom.padStart(2, "0")].join("-");
    if (!/^\$\d+\.\d{2}$/.test(total))
      throw new Error("Expected a USD charge total for Peacock on " + date);
    const amountMinor = Number(total.slice(1).replace(".", ""));
    charges.push({
      id: ["peacock", start, plan, amountMinor].join("/"),
      service: "Peacock",
      chargedOn: start,
      start,
      source: "billing",
      amountMinor,
      currency: "USD",
      estimate: { basis: "billing-cycle", plan, cycle: "monthly" },
      ...(services.length > 1 ? { services } : {}),
    });
  }
  return charges;
}
