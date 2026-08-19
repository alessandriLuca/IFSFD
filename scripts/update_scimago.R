#!/usr/bin/env Rscript

# Build compact yearly SCImago JSON files for the IFSFD GitHub Pages app.
# Source mirror: https://github.com/ikashnitsky/sjrdata

suppressPackageStartupMessages(library(jsonlite))

input_path <- "_sjrdata/data/sjr_journals.rda"
out_dir <- "public/data/scimago"

if (!file.exists(input_path)) {
  stop("SCImago mirror dataset not found: ", input_path)
}

dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

env <- new.env(parent = baseenv())
loaded <- load(input_path, envir = env)

if ("sjr_journals" %in% loaded) {
  df <- env$sjr_journals
} else if (length(loaded) == 1) {
  df <- env[[loaded[[1]]]]
} else {
  stop("Could not identify sjr_journals object in RDA. Objects: ", paste(loaded, collapse = ", "))
}

# A tibble is structurally a data.frame. Force base data.frame dispatch so the
# script does not depend on tidyverse/tibble being installed on the runner.
class(df) <- "data.frame"

pick_col <- function(candidates, required = TRUE) {
  hit <- candidates[candidates %in% names(df)]
  if (length(hit) > 0) return(hit[[1]])
  if (required) stop("Missing expected column. Tried: ", paste(candidates, collapse = ", "))
  NA_character_
}

year_col <- pick_col(c("year"))
issn_col <- pick_col(c("issn", "Issn", "ISSN"))
sjr_col <- pick_col(c("sjr", "SJR"))
quartile_col <- pick_col(c("sjr_best_quartile", "SJR Best Quartile"))
hindex_col <- pick_col(c("h_index", "h-index", "H index", "H Index"))
cites_col <- pick_col(c(
  "cites_doc_2years",
  "citations_doc_2years",
  "avg_citations",
  "Cites / Doc. (2years)"
))
sourceid_col <- pick_col(c("sourceid", "Sourceid", "SourceId", "Source ID"), required = FALSE)
categories_col <- pick_col(c("categories", "Categories"), required = FALSE)

as_number <- function(x) {
  if (length(x) == 0 || is.na(x)) return(NULL)
  value <- suppressWarnings(as.numeric(as.character(x)))
  if (is.na(value)) return(NULL)
  value
}

as_text <- function(x) {
  if (length(x) == 0 || is.na(x)) return("")
  as.character(x)
}

extract_issns <- function(value) {
  if (is.na(value) || !nzchar(as.character(value))) return(character(0))
  text <- toupper(as.character(value))

  matches <- regmatches(
    text,
    gregexpr("[0-9]{4}-?[0-9]{3}[0-9X]", text, perl = TRUE)
  )[[1]]

  if (length(matches) == 1 && identical(matches[[1]], "")) {
    matches <- character(0)
  }

  normalized <- gsub("[^0-9X]", "", matches)
  unique(normalized[nchar(normalized) == 8])
}

year_values <- suppressWarnings(as.integer(as.character(df[[year_col]])))
years <- sort(unique(year_values[!is.na(year_values)]))

if (length(years) == 0) stop("No valid years found in SCImago dataset")

cat("SCImago years found: ", min(years), "-", max(years), "\n", sep = "")

for (year in years) {
  rows <- df[year_values == year, , drop = FALSE]
  by_issn <- list()

  for (i in seq_len(nrow(rows))) {
    issns <- extract_issns(rows[[issn_col]][[i]])
    if (length(issns) == 0) next

    source_id <- if (!is.na(sourceid_col)) as_text(rows[[sourceid_col]][[i]]) else ""
    categories <- if (!is.na(categories_col)) as_text(rows[[categories_col]][[i]]) else ""

    metric <- list(
      sjr = as_number(rows[[sjr_col]][[i]]),
      citesDoc2y = as_number(rows[[cites_col]][[i]]),
      quartile = as_text(rows[[quartile_col]][[i]]),
      hIndex = as_number(rows[[hindex_col]][[i]]),
      sourceId = source_id,
      categories = categories
    )

    for (issn in issns) {
      by_issn[[issn]] <- metric
    }
  }

  payload <- list(
    year = year,
    source = "SCImago Journal & Country Rank via ikashnitsky/sjrdata",
    by_issn = by_issn
  )

  output_path <- file.path(out_dir, paste0(year, ".json"))
  write_json(
    payload,
    output_path,
    auto_unbox = TRUE,
    pretty = FALSE,
    na = "null",
    null = "null"
  )

  cat("[", year, "] ", length(by_issn), " ISSNs -> ", output_path, "\n", sep = "")
}

existing <- list.files(out_dir, pattern = "^[0-9]{4}\\.json$", full.names = TRUE)
expected <- file.path(out_dir, paste0(years, ".json"))
stale <- setdiff(existing, expected)
if (length(stale) > 0) unlink(stale)

manifest <- list(
  min_year = min(years),
  max_year = max(years),
  years = years,
  generated_at = format(Sys.time(), tz = "UTC", usetz = TRUE),
  source = "https://github.com/ikashnitsky/sjrdata"
)

write_json(
  manifest,
  file.path(out_dir, "manifest.json"),
  auto_unbox = TRUE,
  pretty = TRUE,
  na = "null"
)

cat("Manifest updated: ", min(years), "-", max(years), "\n", sep = "")
