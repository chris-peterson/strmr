// The report repeats the four table headings on continuation pages. Use their
// positions to recover wrapped cells without reading other tables as views.
const headers = ["Episode Name", "Series Name", "Season", "Last Played At"];
const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

function viewingEntry(cells) {
  const [episode, series, season, played] = cells.map((parts) =>
    parts.join(" ").trim(),
  );
  const match =
    /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.exec(
      played,
    );
  if (!match || !months.includes(match[2]))
    throw new Error("Unrecognized Last Played At timestamp.");
  const date = [
    match[3],
    String(months.indexOf(match[2]) + 1).padStart(2, "0"),
    match[1].padStart(2, "0"),
  ].join("-");
  const title = episode === "N/A" ? series : episode;
  if (!title || title === "N/A")
    throw new Error("Missing title in Watch History.");
  return {
    service: "Hulu",
    date,
    title,
    lastPlayedAt: date + "T" + match.slice(4).join(":"),
    ...(series && series !== "N/A" ? { series } : {}),
    ...(season && season !== "N/A" ? { season } : {}),
  };
}

export function watchPage(items) {
  const cells = items.filter((item) => item.str?.trim());
  const first = cells.findIndex((item) => item.str.trim() === headers[0]);
  if (
    first < 0 ||
    !headers.every((name, i) => cells[first + i]?.str.trim() === name)
  ) {
    throw new Error("Unrecognized Hulu Watch History table headings.");
  }
  const columns = cells
    .slice(first, first + 4)
    .map((item) => item.transform[4]);
  if (columns.some((x, i) => i && x <= columns[i - 1]))
    throw new Error("Unrecognized Hulu table layout.");
  const headingY = cells[first].transform[5];
  const body = cells.slice(first + 4);
  const timestamps = body
    .filter((item) => item.transform[4] >= columns[3] - 1)
    .sort((a, b) => b.transform[5] - a.transform[5]);
  if (!timestamps.length && body.length)
    throw new Error("Missing Hulu viewing timestamps.");
  const rows = timestamps.map(() => [[], [], [], []]);
  let row = -1;
  // Cells that wrap continue below their row's timestamp until the next one.
  for (const item of body.sort(
    (a, b) =>
      b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  )) {
    const [x, y] = item.transform.slice(4);
    while (
      row + 1 < timestamps.length &&
      y <= timestamps[row + 1].transform[5] + 1
    )
      row++;
    const col = columns.findLastIndex((left) => x >= left - 1);
    if (row < 0 || col < 0 || y >= headingY)
      throw new Error("Unexpected cell in Hulu Watch History.");
    rows[row][col].push(item.str.trim());
  }
  return rows.map(viewingEntry);
}

export async function huluReport(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = (
      await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")
    ).default;
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const viewing = [];
    let found = false;
    for (let page = 1; page <= doc.numPages; page++) {
      const { items } = await (await doc.getPage(page)).getTextContent();
      const strings = items.map((item) => item.str?.trim()).filter(Boolean);
      if (page === 1) {
        const identified =
          strings.includes("Personal Information Report") &&
          strings.some((s) => /\bHulu\b/i.test(s));
        if (!identified)
          throw new Error("Expected a Hulu Personal Information Report PDF.");
      }
      const heading = strings[0] === "Watch History";
      if (!found && !heading) continue;
      if (found && !heading && strings[0] !== headers[0]) {
        if (strings[0] === "Devices And Logins" || strings[0] === "Advertising")
          break;
        throw new Error(
          "Unrecognized continuation after Hulu Watch History on page " + page,
        );
      }
      found = true;
      if (
        heading &&
        strings.some(
          (s) =>
            s ===
            "We have no information about you or your account relevant to this section of the report.",
        )
      )
        break;
      try {
        viewing.push(...watchPage(items));
      } catch (error) {
        throw new Error(
          "Hulu Watch History page " + page + ": " + error.message,
        );
      }
    }
    if (!found)
      throw new Error(
        "Hulu report contains no recognizable Watch History section.",
      );
    return { version: 1, periods: [], viewing };
  } finally {
    await task.destroy();
  }
}
