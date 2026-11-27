# strmr.

Explore a streaming subscription history on a shared calendar. Select a coverage bar for its dates, or a striped overlap segment for the services active together. The Records tab shows the source periods and any recorded charges.

## Supported services

| Service | Payment history | Viewing history |
| --- | --- | --- |
| [Netflix](#netflix-account-history) | Paste the English US payment table or import it as a `.txt` file to record membership dates, charges and tax in USD. | Import `NetflixViewingHistory.csv` with US dates to see titles watched by day. |

## Run locally

With Node 22.12 or later, run `npm ci` and `npm run dev`. Open the printed localhost URL. The dashboard loads the private project ledger from `data/history.yml` on each page load and starts empty if the file is missing.

## Import through Codex

In this checkout, ask Codex to **import my Netflix export** and give it the file path, or paste your Netflix payment history. You can also invoke `$strmr-import` explicitly. The project skill merges records into `data/history.yml`, validates the result and reports how many records it added. Reload an already open local dashboard to see new imports.

The same workflow is available directly through `node scripts/ledger.mjs import "<input path>" data/history.yml`. Use `-` as the input for pasted US Netflix payment history on standard input.

**Import data** in the browser opens a temporary copy. Use **Export YAML** to save that copy. Production builds in `dist/` start empty and can be served from a subdirectory. Personal data stays in the git-ignored project directory.

## Data files

Project paths below are relative to the repository root.

| File | Where it goes |
| --- | --- |
| Original exports | Leave them wherever you downloaded them, such as `~/Downloads/NetflixViewingHistory.csv`. Give the import skill or CLI the file path. |
| Saved ledger | `data/history.yml` holds imported payments and viewing history. The import skill creates it on the first import and merges subsequent imports into it. |
| ZIP backups | The backup command and cron example below write to `backups/`. Each ZIP contains a snapshot named `history.yml`. |

Git ignores both `data/` and `backups/`.

[The v1 JSON Schema](ledger.schema.json) describes the YAML ledger. Each period has a stable ID, service name, source, inclusive start date and exclusive end date. An explicit null end means ongoing. Dates are calendar days. The validator also checks real dates, unique IDs and positive-length periods. Optional charge amounts use whole currency minor units paired with a three-letter currency code.

The chart clips history at today and the selected year. It counts each distinct service once per day, ignoring case and surrounding whitespace. Two subscriptions that hand off on the same day contribute zero overlap days. Different spellings such as HBO Max and Max remain distinct unless you give them the same service name.

Import one of these formats:

- Versioned YAML for complete ledgers or individual batches.
- Coverage CSV with `service,start,end`. Include the end header and leave its value blank for ongoing coverage.
- Billing CSV with `service,date,cycle`. Use the charge date as the first covered day and specify `monthly` or `annual`. Coverage ends after one cycle, clamped to the last day of the target month. For trials, refunds, prorated charges or custom billing windows, supply explicit coverage dates instead.

Normalize provider exports to one of the CSV layouts. Both accept optional `id,source,amountMinor,currency` columns. Source defaults to `billing`. Dates use YYYY-MM-DD. Use a stable source ID when available. The fallback ID combines the normalized service and start date. Merging skips identical records and rejects conflicting IDs.

## Scheduled ZIP backups

The local CLI and browser share the same validation and import logic. Create a canonical file by importing a billing export, or save the browser's exported YAML as `data/history.yml`.

```sh
npm run ledger -- validate data/history.yml
npm run ledger -- backup data/history.yml backups
```

For a nightly 02:00 backup, add the following entry with `crontab -e`. Replace the executable and checkout paths with the absolute paths from `command -v node` and `pwd`. This runs with the browser closed and the machine awake.

```cron
0 2 * * * cd "/absolute/path/to/strmr" && "/absolute/path/to/node" scripts/ledger.mjs backup data/history.yml backups
```

Each run validates the on-disk YAML and archives it as `history.yml` inside a uniquely named ZIP. Extract that file and import it to restore a snapshot. Browser edits reach cron when you save the exported file to the configured path. CLI imports use a lock and atomic rename. After an interrupted import, verify the writer has exited before removing a stale `data/.history.yml.lock`.

Run `npm test` to check interval boundaries, import validation, repeat imports and ZIP recovery.

## Estimate coverage from a charge

When a statement gives a service, date and amount, import a CSV with `service,date,amountMinor,currency`. The same importer runs in the browser and the CLI.

strmr matches a single base plan by service, currency, exact list price and charge date within MapSub’s inclusive observation dates. Prices cover US plans and Netflix UK in GBP. An amount may include tax, a promotion or an add-on. For a missing or ambiguous match, the import identifies the record and asks for its cycle or explicit coverage dates. The whole batch must validate before import. A supplied cycle or coverage window takes precedence.

Estimated periods have a dashed outline on the timeline. In Records, expand **MapSub estimate** to see the matched plan, cycle, price observation dates and evidence. Clear **Include MapSub estimates** to compare overlap using the other records alone. Exported YAML retains the match, so a future catalog refresh leaves saved histories reproducible.

Historical list prices are adapted from [MapSub’s subscription price histories](https://mapsub.com/data/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The bundled subset selects streaming plans and converts prices to minor units. Observation dates describe the available price evidence. Each estimate assumes one billing cycle starting on the charge date. The app performs all matching locally.

For a monthly catalog refresh at 03:00 on the first day of each month, add this entry to your crontab using your absolute paths.

```cron
0 3 1 * * cd "/absolute/path/to/strmr" && "/absolute/path/to/node" scripts/mapsub.mjs
```

Refresh the bundled catalog with `node scripts/mapsub.mjs`, or pass the path to a downloaded MapSub `all.csv`. Rebuild the site after refreshing.

## Netflix account history

In **Import data**, choose **Paste Netflix payment history (USD)** and paste the English US payment table, including the total and tax breakdown for each membership row. You can also import the copied text as a `.txt` file. The importer records the payment date, subtotal, tax and total, and converts Netflix's inclusive last covered day to the ledger's exclusive end. Each listed payment produces one period. Card identifiers and account-page text are discarded.

Open `NetflixViewingHistory.csv` through the same file picker or CLI. The importer recognizes the `Title,Date` columns in the US export and keeps the titles and dates in the ledger's optional `viewing` array. The **Viewing** tab displays them by year. Viewing activity can predate the available bills and is excluded from paid coverage and overlap totals. Re-imports merge by service, title and day.

## Price per view

In **Viewing**, select **Month** for each month of the selected year, **Year** for the year total, or **All time** for all recorded years. Each row divides the service’s cost by its imported viewing entries during priced coverage. Charges with a known amount and end date are allocated evenly across their covered days through today. A billing period that crosses a month or year boundary contributes proportionally to each side. Each currency has its own row. A dash means there were no recorded views during that priced coverage.
