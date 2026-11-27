---
name: strmr-import
description: Import streaming subscription, payment, or viewing history into this strmr checkout from a file path or pasted records. Use when the user supplies an export or asks to refresh their local ledger.
---

Run the importer from the strmr repository root. The default destination is the private, git-ignored `data/history.yml`. The dashboard served by `npm run dev` reads this file on page load.

- For a supplied file, run `node scripts/ledger.mjs import "<input path>" data/history.yml`. Use the path as a single argument. Supported inputs include Netflix viewing CSV, Hulu Personal Information Report PDF (Watch History), US Hulu charge history TXT, US Netflix payment history TXT, strmr YAML, and the coverage and charge CSV layouts in README.md.
- Pass a downloaded Hulu report PDF directly to the CLI. It extracts Watch History locally and retains the reported timestamps. README.md documents the Request Report and email verification flow.
- For pasted US Hulu or Netflix payment history, send the text to `node scripts/ledger.mjs import - data/history.yml` on standard input. For Hulu, include the Date, Description and Total headers, full bundle labels and every charge row. For Netflix, include the membership ranges, totals and tax breakdown. For other pasted formats, use a private temporary file with the appropriate extension and remove it after import.
- For an unrecognized export, inspect the header and only the rows needed to map it. Use the documented CSV or YAML schema when the mapping is clear. Preserve explicit coverage dates, currencies, amounts, and stable IDs. Ask about ambiguous fields before recording them. Keep viewing activity separate from paid coverage.
- Merge each supplied source through the CLI. It validates and writes atomically. If a source fails, report which one and why. Summarize added and total counts for the successful imports, including zero additions for already imported files. Verify the saved ledger with `node scripts/ledger.mjs validate data/history.yml`.
