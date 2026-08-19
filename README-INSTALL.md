# IFSFD - SCImago metrics upgrade

This overlay adds:

- SCImago Best Quartile (Q1-Q4)
- Cites / Doc. (2 years)
- SJR
- H-index
- SCImago categories in expandable details
- the same fields in CSV export

## Copy into your existing IFSFD project

Replace:
- `src/App.jsx`
- `src/App.css`

Add:
- `scripts/update_scimago.py`

## Refresh the SCImago dataset

From the root of IFSFD run:

`python3 scripts/update_scimago.py`

The script downloads the official SCImago yearly export for 1999-2025 and
overwrites `public/data/scimago/<year>.json`.

No API key and no external Python packages are required.

The script reads the official SCImago fields:
- `SJR Best Quartile`
- `SJR`
- `Cites / Doc. (2years)`
- `H index`
- `Categories`
- `Sourceid`
- `Issn`

## Test

Run the updater first, then:

`npm run dev`

Try:
`10.3390/ijms22084217`

The app will retrieve the article metadata from Crossref and match the 2021
SCImago record by ISSN.

## Important

SCImago metrics are based on Scopus data. They are not the proprietary
Clarivate Journal Impact Factor (JIF).
