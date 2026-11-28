# strmr.

The dashboard opens to year to date (YTD), from January 1 through today. A prior-year button appears for each year with subscription coverage or imported views. Select it to see that calendar year across Timeline, Records and Viewing. The Months column counts each calendar month with at least one covered day for that service in the selected year, through today. Overlapping bills and bundles count once per month. **Days left** counts the days remaining on each service’s latest bill, including today for YTD or December 31 for a prior year. The last covered day counts as one, and an expired bill shows zero. Hover over the count for the end date. The price-per-view panel below the timeline shows the selected period’s allocated costs and covered views. Select a coverage bar for its dates and billing source. The Records tab shows the source periods and any recorded charges.

Bookmark the dashboard after choosing a year or tab. For example, `?year=2025&view=records` opens the 2025 subscription records, and `?year=ytd` follows the current year. The URL also preserves the coverage filter, monthly viewing breakdown and inactivity threshold.

## Supported services

| Service | Payment history | Viewing history |
| --- | --- | --- |
| [Netflix](#netflix-account-history) | Paste the English US payment table or import it as a `.txt` file to record membership dates, charges and tax in USD. | Import `NetflixViewingHistory.csv` with US dates to see titles watched by day. |
| [Hulu](#hulu-charge-history) | Import the US charge table for Hulu Premium and the monthly bundles listed below. | Import the Watch History table from the Hulu Personal Information Report PDF. [Request a report](#hulu-privacy-report) |
| [Peacock](#peacock-account-history) | Paste US Premium Plus Monthly or Apple TV and Peacock Premium Plus payments, or import the copied rows as a `.txt` file. | Import dated titles in a strmr viewing CSV. |
| [Paramount+](#paramount-account-history) | Paste US PayPal activity for a confirmed monthly plan, or import receipts in a strmr billing CSV. | Import dated titles in a strmr viewing CSV. |
| [Crunchyroll](https://www.crunchyroll.com/payments/history) | Paste completed US Fan (Monthly) payment rows or import them as a text file. Each charge starts one monthly cycle. | Import dated titles in a strmr viewing CSV. |
| Apple TV | Import Apple Services bundle payments using YAML. List the other subscriptions in `nonVideoServices` when the video share is unknown. Monthly spend includes the full payment. Allocated video cost and cost per view exclude it. | Import dated titles in a strmr viewing CSV when available. |

## Run locally

With Node 22.12 or later, run `npm ci` and `npm run dev`. Open the printed localhost URL. The dashboard loads your history from `data/history.yml` on each page load and starts empty if the file is missing.

## Import through Codex

In this checkout, ask Codex to **import my Netflix export** and give it the file path, or paste your Crunchyroll, Hulu, Netflix or Peacock payment history. You can also invoke `$strmr-import` explicitly. The project skill merges records into `data/history.yml`, validates the result and reports how many records it added. Reload an already open local dashboard to see new imports.

The same workflow is available directly through `node scripts/ledger.mjs import "<input path>" data/history.yml`. Use `-` as the input for pasted US Crunchyroll, Hulu, Netflix or Peacock payment history on standard input.

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

The chart clips history at today and the selected year. It counts each distinct service once per day, ignoring case and surrounding whitespace. The timeline shows the average and median number of covered video services per calendar day in the selected window. Each day counts equally, including days with zero recorded coverage. Different spellings such as HBO Max and Max remain distinct unless you give them the same service name.

Import one of these formats:

- Versioned YAML for complete ledgers or individual batches.
- Coverage CSV with `service,start,end`. Include the end header and leave its value blank for ongoing coverage.
- Billing CSV with `service,date,cycle`. Use the charge date as the first covered day and specify `monthly` or `annual`. Coverage ends after one cycle, clamped to the last day of the target month. Use explicit coverage dates for a partial or custom billing period.

The billing and coverage CSV layouts accept optional `id,source,amountMinor,currency` columns. Source defaults to `billing`. Dates use YYYY-MM-DD. Use a stable source ID when available. The fallback ID combines the normalized service and start date. Merging skips identical records and rejects conflicting IDs.

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

## Coverage from a charge

When a statement gives a service, date and amount, import a CSV with `service,date,amountMinor,currency`. The same importer runs in the browser and the CLI.

strmr matches a single base plan by service, currency, exact list price and charge date within MapSub’s inclusive observation dates. Prices cover US plans and Netflix UK in GBP. An amount may include tax, a promotion or an add-on. For a missing or ambiguous match, the import identifies the record and asks for its cycle or explicit coverage dates. The whole batch must validate before import. A supplied cycle or coverage window takes precedence.

Periods inferred from a price match have a dashed outline on the timeline. In Records, expand **Historical price match** to see the matched plan, cycle, price observation dates and evidence. Clear **Include coverage derived from charge dates** to calculate daily counts using the other records alone. Exported YAML retains the match, so a future catalog refresh leaves saved histories reproducible.

Historical list prices are adapted from [MapSub’s subscription price histories](https://mapsub.com/data/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The bundled subset selects streaming plans and converts prices to minor units. Observation dates describe the available price evidence. Each price match supplies one billing cycle starting on the charge date. The app performs all matching locally.

For a monthly catalog refresh at 03:00 on the first day of each month, add this entry to your crontab using your absolute paths.

```cron
0 3 1 * * cd "/absolute/path/to/strmr" && "/absolute/path/to/node" scripts/mapsub.mjs
```

Refresh the bundled catalog with `node scripts/mapsub.mjs`, or pass the path to a downloaded MapSub `all.csv`. Rebuild the site after refreshing.

## Hulu charge history

Copy the **Date**, **Description**, and **Total** headers and all charge rows from [Hulu charge history](https://secure.hulu.com/commerce/charges?view=history). Paste them into Codex with `$strmr-import`, use the browser payment-history input, or import the text as a `.txt` file.

The US importer recognizes Hulu Premium (Monthly) and monthly Disney+ and Hulu bundles with Disney+ and Hulu alone, ESPN Select, or HBO Max (No Ads). Each row keeps its charge date, full plan label and USD total. Each bundle contributes one charge and a timeline entry for each included service. Price per view groups a bundle’s cost and covered views together.

Hulu’s table supplies the billing cycle. Its outlined **Billing cycle** bars count one calendar month from the charge date. Plan switches and prorated charges can shorten the actual coverage. Same-day charges with different plans or totals are retained, and missing renewals leave gaps.

## Hulu privacy report

1. Sign in to Hulu, open **Account → Privacy**, and select **Request Report**. [Hulu account privacy](https://secure.hulu.com/account/privacy)
2. Follow the verification emails through to the report portal. The flow can involve several emails, CAPTCHAs, one-time codes, and another sign-in. When the report is ready, download the Personal Information Report PDF.
3. Leave the PDF in Downloads and give its path to `$strmr-import`. The CLI equivalent is `node scripts/ledger.mjs import "/path/to/rtk-report.pdf" data/history.yml`. The browser file picker also accepts the PDF for a temporary preview.

strmr reads the **Watch History** table and its continuation pages locally. It keeps the episode or movie title, series, season, and **Last Played At** timestamp as printed. Each distinct dated playback observation counts once, including on repeat imports. Hulu describes the report as covering the preceding twelve months with exceptions. Last-played observations can undercount rewatches, so price per view reflects the imported rows. Membership periods and amounts come from the separate charge-history import. Personal, payment-method, device, and login details stay outside the ledger.

## Netflix account history

In **Import data**, choose **Paste payment history (USD)** and paste the English US payment table, including the total and tax breakdown for each membership row. You can also import the copied text as a `.txt` file. The importer records the payment date, subtotal, tax and total, and converts Netflix's inclusive last covered day to the ledger's exclusive end. Each listed payment produces one period. Card identifiers and account-page text are discarded.

Open `NetflixViewingHistory.csv` through the same file picker or CLI. The importer recognizes the `Title,Date` columns in the US export and keeps the titles and dates in the ledger's optional `viewing` array. The **Viewing** tab groups playback cards by month in the selected year. The service badges cycle through neutral, included, and excluded. Including multiple services shows entries from any of them. The URL saves the selection, which applies only to the viewing grid. Each card shows the service, title, available episode details and a link to search IMDb for the film or series. Viewing activity can predate the available bills and does not add paid coverage. Re-imports merge by service, title and day.

## Peacock account history

For direct Peacock billing, open **Account → Plans & Payment → View Payment History**. For a subscription billed through another provider, use that provider’s receipts. [Peacock payment history guide](https://www.peacocktv.com/help/article/how-do-i-view-my-payment-history-or-upcoming-payments)

Copy the rows from the [Peacock payment history page](https://www.peacocktv.com/account/plans/payment-history). The CLI and browser recognize the four lines per payment: plan, US date, payment method and USD total. The import keeps zero-dollar entries and discards payment method details. The timeline projects one month of coverage from each charge date. The Apple TV and Peacock Premium Plus plan covers both services under one charge. [Peacock bundle details](https://www.peacocktv.com/bundle/apple-tv)

For watch history, use the access-request link for your location under **Your Rights**. Ask for Peacock viewing events with titles, profiles and playback dates or timestamps in a machine-readable format. The fields and history available depend on the response. [NBCUniversal privacy policy](https://www.nbcuniversal.com/privacy-english)

Enter `Peacock` in the billing CSV’s `service` column. Use the actual charge and currency. For a US dollar charge, `amountMinor` is the total in cents. Use explicit `start,end` dates when the receipt gives a coverage period, or `date,cycle` when the charge starts a known monthly or annual cycle. Include a distinct `id` for separate charges on the same day.

For viewing history, import a strmr CSV with `service,date,title` columns. Use `Peacock` for the service and YYYY-MM-DD for the date. Optional `lastPlayedAt` (YYYY-MM-DDTHH:mm:ss), `series` and `season` preserve playback details when available. Repeat imports skip identical entries. Viewing rows appear in the dashboard even when corresponding bills are missing.

## Paramount+ account history

Start with a completed charge from Paramount+ or the provider that billed the subscription. Use `Paramount+` in the CSV’s `service` column. Include the amount paid and the covered dates, or the charge date and billing cycle when the receipt gives them. [Paramount+ account](https://www.paramountplus.com/account/)

For a confirmed monthly plan paid through PayPal, select **Paramount+ monthly via PayPal (USD)** in the import dialog and paste the month headings, merchant, outgoing amounts and payment dates. The CLI accepts the same text via `node scripts/ledger.mjs import - data/history.yml --paypal-monthly`. Include month and year headings when available. If a relative heading cannot be dated from an adjacent month, replace it with its actual month and year. The importer projects one monthly cycle per payment and preserves gaps between cycles.

To request viewing history, ask for the titles, episodes and playback timestamps across your Paramount+ profiles in a machine-readable format. You can also request subscription periods and billing transactions. Dated viewing rows can be imported with `service,date,title` and optional `lastPlayedAt`. [Paramount privacy access request](https://privacy.paramount.com/consumer)

## Price per view

The summary cards show total cost, average monthly spend, views, and cost per view for the selected window. Total cost sums recorded payments in each currency. Cost per view divides the total allocated cost in each currency by the number of distinct viewing entries covered by a bill in that currency. A view covered by both a bundle and a direct subscription counts once in that total.

Hover or focus a month on the timeline or in viewing history to see its recorded spend. Each bill counts once in its charge month, using the coverage start if the charge date is missing. **Average monthly spend** divides recorded payments by every calendar month in the selected window, including the current partial month. The sparkline shows those monthly totals in order. Months without payments contribute zero recorded spend. Missing bills can lower the average. Each currency has its own average and trend.

If coverage ended early, set `lastCoveredOn` to the final covered date.

In **Viewing**, **Total** shows price per view for the selected period. Choose **Month** to break the same period down by calendar month. Each row divides the service’s cost by its imported viewing entries during priced coverage. Charges with a known amount and end date are allocated evenly across their covered days through today. A billing period that crosses a month or year boundary contributes proportionally to each side. Each currency has its own row. A dash means there were no recorded views during that priced coverage.

Open **Which views count?** below the table to see how many views each service contributed to the calculation.


## Inactivity

The timeline lists stretches of 30, 60 or 90 consecutive covered days with no imported views. Streaks start no earlier than the service’s first imported viewing day. Active days from adjacent bills and bundles are combined, and a lapse in coverage breaks the streak. A viewing day resets the count. Only idle days inside the selected period count toward the minimum streak length. The coverage filter also applies to inactivity.

The result depends on which profiles and dates your viewing exports cover. Services without viewing data are listed separately. The period summary counts all imported views in the window. Its cost breakdown counts views during priced coverage and keeps bundle charges together.

## Provider logos

The dashboard ships local copies of the provider artwork. Wikimedia Commons lists these files as public-domain logos and identifies the providers' trademark interests on the individual file pages.

- [Crunchyroll](https://commons.wikimedia.org/wiki/File:Crunchyroll_2024_stacked.svg)
- [Netflix](https://commons.wikimedia.org/wiki/File:Netflix_2016_N_logo.svg)
- [Hulu](https://commons.wikimedia.org/wiki/File:Hulu_logo_%282018%29.svg)
- [Disney+](https://commons.wikimedia.org/wiki/File:Disney%2B_logo.svg)
- [ESPN (used for ESPN Select)](https://commons.wikimedia.org/wiki/File:ESPN_wordmark.svg)
- [HBO Max](https://commons.wikimedia.org/wiki/File:HBO_Max_%282025%29.svg)
- [Peacock](https://commons.wikimedia.org/wiki/File:NBCUniversal_Peacock_Logo_%282026%29.svg)
- [Apple TV](https://commons.wikimedia.org/wiki/File:Apple_TV_logo.svg)
- [Apple TV+](https://commons.wikimedia.org/wiki/File:Apple_TV_Plus_Logo.svg)
- [Paramount+](https://commons.wikimedia.org/wiki/File:Paramount%2B_logo.svg)
