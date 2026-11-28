// PayPal activity is newest first. Month headings supply the year omitted on
// individual payments. A relative heading can also cross a December boundary.
const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const heading = /^([A-Z][a-z]{2}) (\d{4})$/;
const relativeHeading = /^(?:Today|Yesterday|This week|Last week|This month|Last month)$/i;

export function paramountPayments(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let section;
  const charges = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i++];
    const dated = heading.exec(line);
    if (dated && months.includes(dated[1])) {
      section = { month: months.indexOf(dated[1]), year: Number(dated[2]) };
      continue;
    }
    if (relativeHeading.test(line)) {
      section = undefined;
      continue;
    }
    if (line.toUpperCase() !== "PARAMOUNT+")
      throw new Error("Expected a Paramount+ merchant row in PayPal activity.");

    const amount = /^[−-]\$(\d+)\.(\d{2})$/.exec(lines[i++]);
    const date = /^([A-Z][a-z]{2}) (\d{1,2})(?:,? (\d{4}))?\s*[.·•]\s*Payment$/i.exec(lines[i++]);
    if (!amount || !date || !months.includes(date[1]))
      throw new Error("Expected an outgoing USD amount and a dated PayPal Payment.");
    const month = months.indexOf(date[1]);
    let year = Number(date[3]) || section?.year;
    if (section && (section.month !== month || section.year !== year))
      throw new Error("PayPal payment date disagrees with its month heading.");
    if (!year) {
      const next = lines.slice(i).map((s) => heading.exec(s)).find((m) => m && months.includes(m[1]));
      const priorMonth = next ? months.indexOf(next[1]) : -1;
      if (!next || (month - priorMonth + 12) % 12 > 1)
        throw new Error("Replace the relative PayPal heading with its month and year, such as Nov 2026.");
      year = Number(next[2]) + (month < priorMonth ? 1 : 0);
    }
    const start = [year, String(month + 1).padStart(2, "0"), date[2].padStart(2, "0")].join("-");
    const amountMinor = Number(amount[1] + amount[2]);
    charges.push({
      id: ["paypal", "paramount+", start, amountMinor].join("/"),
      service: "Paramount+",
      source: "billing",
      chargedOn: start,
      start,
      currency: "USD",
      amountMinor,
      estimate: { basis: "billing-cycle", plan: "Paramount+ via PayPal", cycle: "monthly" },
    });
  }
  if (!charges.length) throw new Error("No Paramount+ payments found.");
  return charges;
}
