IFSFD SCImago GitHub Actions fix

Replace these two files in your IFSFD repository:

- .github/workflows/update-scimago.yml
- scripts/update_scimago.R

The old scripts/update_scimago.py can stay in the repository; it is no longer used.

The workflow now reads the public historical SCImago mirror from:
https://github.com/ikashnitsky/sjrdata

It no longer requests scimagojr.com directly, avoiding the HTTP 403 seen on GitHub Actions.
