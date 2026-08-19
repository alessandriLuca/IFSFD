#!/usr/bin/env python3
"""Build compact yearly SCImago JSON files for the IFSFD GitHub Pages app.

The script downloads the public yearly SCImago Journal & Country Rank export,
indexes journals by ISSN, and writes public/data/scimago/<year>.json plus a
manifest.json used by the browser app.

No API key and no third-party Python packages are required.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_MIN_YEAR = 1999
DEFAULT_MAX_YEAR = datetime.now(timezone.utc).year
BASE_URL = "https://www.scimagojr.com/journalrank.php?year={year}&type=all&out=xls"


def normalize_issn(value: str) -> str:
    return re.sub(r"[^0-9X]", "", str(value or "").upper())


def as_number(value):
    text = str(value or "").strip()
    if not text or text in {"-", "N/A", "NA"}:
        return None

    if "," in text and "." not in text:
        text = text.replace(",", ".")

    try:
        number = float(text)
        return int(number) if number.is_integer() else number
    except ValueError:
        return None


def pick(row, *names):
    for name in names:
        if name in row and str(row[name]).strip():
            return str(row[name]).strip()
    return ""


def download_year(year: int) -> str:
    request = Request(
        BASE_URL.format(year=year),
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; IFSFD-SCImago-Updater/1.0; +https://github.com/alessandriLuca/IFSFD)",
            "Accept": "text/csv,text/plain,*/*",
        },
    )

    last_error = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=90) as response:
                raw = response.read()
                content_type = response.headers.get("Content-Type", "")

            text = None
            for encoding in ("utf-8-sig", "utf-8", "latin-1"):
                try:
                    text = raw.decode(encoding)
                    break
                except UnicodeDecodeError:
                    pass

            if text is None:
                raise RuntimeError("Could not decode SCImago response")

            if "<html" in text[:1000].lower():
                raise RuntimeError("SCImago returned HTML instead of the data export")

            first_line = text.splitlines()[0] if text.splitlines() else ""
            if "Issn" not in first_line and "ISSN" not in first_line:
                raise RuntimeError(
                    f"Unexpected SCImago response (Content-Type: {content_type})"
                )

            # If SCImago has not published the requested year yet, the site may
            # return another year's table. Reject that instead of mislabelling it.
            if f"Total Docs. ({year})" not in first_line:
                raise RuntimeError(f"SCImago {year} dataset is not published yet")

            return text
        except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(2 * (attempt + 1))

    raise RuntimeError(str(last_error))


def parse_year(text: str, year: int) -> dict:
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    if not reader.fieldnames:
        raise RuntimeError(f"No CSV header found for {year}")

    by_issn = {}

    for row in reader:
        issn_field = pick(row, "Issn", "ISSN")
        if not issn_field:
            continue

        metric = {
            "sjr": as_number(pick(row, "SJR")),
            "citesDoc2y": as_number(
                pick(
                    row,
                    "Cites / Doc. (2years)",
                    "Cites / Doc. (2 years)",
                    "Cites / Doc. (2 Years)",
                )
            ),
            "quartile": pick(row, "SJR Best Quartile", "SJR Quartile"),
            "hIndex": as_number(pick(row, "H index", "H Index")),
            "sourceId": pick(row, "Sourceid", "SourceId", "Source ID"),
            "categories": pick(row, "Categories"),
        }

        for raw_issn in re.split(r"[,;]", issn_field):
            issn = normalize_issn(raw_issn)
            if issn:
                by_issn[issn] = metric

    if not by_issn:
        raise RuntimeError(f"No ISSNs parsed for {year}")

    return {
        "year": year,
        "source": "SCImago Journal & Country Rank",
        "by_issn": by_issn,
    }


def existing_years(output: Path) -> list[int]:
    years = []
    for path in output.glob("*.json"):
        if path.name == "manifest.json":
            continue
        try:
            years.append(int(path.stem))
        except ValueError:
            pass
    return sorted(set(years))


def write_manifest(output: Path) -> dict:
    years = existing_years(output)
    if not years:
        raise RuntimeError("No SCImago yearly datasets are available")

    manifest = {
        "source": "SCImago Journal & Country Rank",
        "source_url": "https://www.scimagojr.com/journalrank.php",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "min_year": min(years),
        "max_year": max(years),
        "years": years,
    }

    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-year", type=int, default=DEFAULT_MIN_YEAR)
    parser.add_argument("--max-year", type=int, default=DEFAULT_MAX_YEAR)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public" / "data" / "scimago",
    )
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    failures = []
    updated = []

    for year in range(args.min_year, args.max_year + 1):
        destination = args.output / f"{year}.json"
        print(f"[{year}] fetching SCImago...", flush=True)

        try:
            dataset = parse_year(download_year(year), year)
            destination.write_text(
                json.dumps(dataset, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            updated.append(year)
            print(f"[{year}] {len(dataset['by_issn']):,} ISSNs", flush=True)
        except Exception as error:
            failures.append((year, str(error), destination.exists()))
            if destination.exists():
                print(f"[{year}] keeping existing file: {error}", file=sys.stderr)
            else:
                print(f"[{year}] unavailable: {error}", file=sys.stderr)

        time.sleep(0.35)

    manifest = write_manifest(args.output)

    print(
        f"\nManifest: {manifest['min_year']}–{manifest['max_year']} "
        f"({len(manifest['years'])} yearly datasets)."
    )
    print(f"Updated this run: {len(updated)} year(s).")

    missing_historical = [
        year
        for year, _, had_existing in failures
        if not had_existing and year < manifest["max_year"]
    ]

    if missing_historical:
        print(
            "Missing historical datasets: " + ", ".join(map(str, missing_historical)),
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
