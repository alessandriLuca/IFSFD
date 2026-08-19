# IFSFD automatic SCImago refresh

Copy this overlay into the root of the IFSFD repository.

Files added/replaced:

- `.github/workflows/update-scimago.yml`
- `scripts/update_scimago.py`
- `src/App.jsx`
- `src/App.css`
- `public/data/scimago/manifest.json`

Keep the existing `public/data/scimago/*.json` files already in the project.
The GitHub Action refreshes them automatically from SCImago.

## What happens after push

1. The workflow runs automatically because the workflow/script/frontend files changed.
2. It downloads every SCImago year from 1999 through the current calendar year.
3. If the newest year is not published yet, the previous latest year remains active.
4. It writes compact yearly JSON files containing:
   - SJR Best Quartile
   - Cites / Doc. (2 years)
   - SJR
   - H-index
   - categories
5. It creates `manifest.json` with the years actually available.
6. It commits refreshed data to `main` when data changed.
7. It builds Vite and deploys the site to the existing `gh-pages` branch.
8. The same refresh runs automatically on the first day of every month.

No SCImago update command needs to be run manually on your computer.
