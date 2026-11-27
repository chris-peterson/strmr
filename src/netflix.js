// Netflix's English (US) account page and viewing export both use month/day/year.
export function netflixDate(value) {
  const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(value);
  if (!parts) throw new Error("Invalid Netflix date: " + value);
  const [, month, day, year] = parts;
  const iso = [
    year.length === 2 ? "20" + year : year,
    month.padStart(2, "0"),
    day.padStart(2, "0"),
  ].join("-");
  const date = new Date(iso);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== iso
  ) {
    throw new Error("Invalid Netflix date: " + value);
  }
  return iso;
}

export function netflixPayments(text) {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  let current;
  for (const line of lines) {
    if (/^\d{1,2}\/\d{1,2}\/\d{4}(?:\s|$)/.test(line)) {
      current = [];
      rows.push(current);
    }
    if (current) current.push(line);
  }
  if (!rows.length)
    throw new Error(
      "Paste the US Netflix payment history including each payment date, membership range and total.",
    );
  return rows.map((lines) => {
    const row = lines.join(" ");
    const chargedOn = netflixDate(row.split(/\s/)[0]);
    const range =
      /Membership for\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/i.exec(
        row,
      );
    const price =
      /\$(\d+\.\d{2})\s+\$(\d+\.\d{2})\s*\(\s*\+\$(\d+\.\d{2})\s+tax\s*\)/i.exec(
        row,
      );
    if (!range || !price)
      throw new Error(
        "Incomplete Netflix membership dates or USD charge breakdown on " +
          chargedOn,
      );
    const start = netflixDate(range[1]);
    const last = netflixDate(range[2]);
    const [amountMinor, subtotalMinor, taxMinor] = price
      .slice(1)
      .map((value) => Number(value.replace(".", "")));
    return {
      id: "netflix/" + start,
      service: "Netflix",
      start,
      end: new Date(Date.parse(last) + 86400000).toISOString().slice(0, 10),
      chargedOn,
      source: "billing",
      currency: "USD",
      amountMinor,
      subtotalMinor,
      taxMinor,
    };
  });
}
