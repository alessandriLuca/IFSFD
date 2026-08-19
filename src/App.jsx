import { useEffect, useMemo, useState } from 'react'
import './App.css'

const CROSSREF_BASE = 'https://api.crossref.org/works'
const FALLBACK_MIN_YEAR = 1999
const FALLBACK_MAX_YEAR = 2025
const scimagoCache = new Map()

function cleanDoi(value) {
  return value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;]+$/, '')
}

function splitDois(text) {
  return [...new Set(
    text
      .split(/[\s,;]+/)
      .map(cleanDoi)
      .filter(Boolean),
  )]
}

function doiPath(doi) {
  return doi.split('/').map(encodeURIComponent).join('/')
}

function publicationYear(message) {
  const candidates = [
    message.published,
    message['published-print'],
    message['published-online'],
    message.issued,
    message.created,
  ]

  for (const candidate of candidates) {
    const year = candidate?.['date-parts']?.[0]?.[0]
    if (year) return Number(year)
  }

  return null
}

function normalizeIssn(value) {
  return String(value || '').toUpperCase().replace(/[^0-9X]/g, '')
}

async function fetchCrossref(doi) {
  const response = await fetch(`${CROSSREF_BASE}/${doiPath(doi)}`)

  if (!response.ok) {
    throw new Error(`Crossref HTTP ${response.status}`)
  }

  const payload = await response.json()
  const message = payload.message

  return {
    doi,
    title: message.title?.[0] || '',
    journal: message['container-title']?.[0] || '',
    year: publicationYear(message),
    issns: message.ISSN || [],
  }
}

function fallbackManifest() {
  return {
    min_year: FALLBACK_MIN_YEAR,
    max_year: FALLBACK_MAX_YEAR,
    years: Array.from(
      { length: FALLBACK_MAX_YEAR - FALLBACK_MIN_YEAR + 1 },
      (_, index) => FALLBACK_MIN_YEAR + index,
    ),
    generated_at: '',
  }
}

async function fetchManifest() {
  const url = `${import.meta.env.BASE_URL}data/scimago/manifest.json`
  const response = await fetch(url, { cache: 'no-store' })

  if (!response.ok) {
    return fallbackManifest()
  }

  const manifest = await response.json()
  if (!Array.isArray(manifest.years) || manifest.years.length === 0) {
    return fallbackManifest()
  }

  return manifest
}

async function loadScimagoYear(year) {
  if (scimagoCache.has(year)) {
    return scimagoCache.get(year)
  }

  const url = `${import.meta.env.BASE_URL}data/scimago/${year}.json`
  const promise = fetch(url, { cache: 'force-cache' }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`SCImago dataset ${year}: HTTP ${response.status}`)
    }
    return response.json()
  })

  scimagoCache.set(year, promise)
  return promise
}

function unpackMetric(hit) {
  if (!hit) return null

  if (Array.isArray(hit)) {
    return {
      sjr: hit[0] ?? null,
      citesDoc2y: hit[1] ?? null,
      quartile: hit[2] || '',
      hIndex: hit[3] ?? null,
      sourceId: hit[4] || '',
      categories: hit[5] || '',
    }
  }

  return {
    sjr: hit.sjr ?? null,
    citesDoc2y: hit.citesDoc2y ?? null,
    quartile: hit.quartile || '',
    hIndex: hit.hIndex ?? null,
    sourceId: hit.sourceId || '',
    categories: hit.categories || '',
  }
}

function findScimagoMetric(record, dataset) {
  if (!dataset) return null

  for (const rawIssn of record.issns || []) {
    const issn = normalizeIssn(rawIssn)
    const hit = unpackMetric(dataset.by_issn?.[issn])

    if (hit) {
      return {
        ...hit,
        matchedIssn: rawIssn,
      }
    }
  }

  return null
}

function csvEscape(value) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function quartileClass(quartile) {
  const q = String(quartile || '').toUpperCase()
  return /^Q[1-4]$/.test(q) ? `quartile ${q.toLowerCase()}` : 'quartile'
}

function formatRefreshDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function App() {
  const [input, setInput] = useState('10.3390/ijms22084217')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [manifest, setManifest] = useState(fallbackManifest())

  useEffect(() => {
    fetchManifest().then(setManifest).catch(() => setManifest(fallbackManifest()))
  }, [])

  const dois = useMemo(() => splitDois(input), [input])
  const availableYears = useMemo(() => new Set(manifest.years || []), [manifest])

  async function search() {
    if (dois.length === 0) return

    setLoading(true)
    const output = []

    for (const doi of dois) {
      try {
        const record = await fetchCrossref(doi)

        if (!record.year) {
          output.push({
            ...record,
            status: 'Publication year not found',
          })
          continue
        }

        if (!availableYears.has(record.year)) {
          output.push({
            ...record,
            status: record.year > manifest.max_year
              ? `SCImago ${record.year} data not available yet; latest dataset is ${manifest.max_year}`
              : `SCImago dataset ${record.year} is not available`,
          })
          continue
        }

        const dataset = await loadScimagoYear(record.year)
        const metric = findScimagoMetric(record, dataset)

        output.push({
          ...record,
          sjr: metric?.sjr ?? null,
          citesDoc2y: metric?.citesDoc2y ?? null,
          quartile: metric?.quartile || '',
          hIndex: metric?.hIndex ?? null,
          sourceId: metric?.sourceId || '',
          categories: metric?.categories || '',
          matchedIssn: metric?.matchedIssn || '',
          status: metric
            ? 'SCImago match found'
            : 'Journal not found in SCImago for this year',
        })
      } catch (error) {
        output.push({
          doi,
          title: '',
          journal: '',
          year: '',
          issns: [],
          sjr: null,
          citesDoc2y: null,
          quartile: '',
          hIndex: null,
          sourceId: '',
          categories: '',
          matchedIssn: '',
          status: error.message,
        })
      }
    }

    setResults(output)
    setLoading(false)
  }

  function exportCsv() {
    const headers = [
      'doi',
      'title',
      'journal',
      'publication_year',
      'issn',
      'scimago_best_quartile',
      'scimago_cites_per_doc_2y',
      'sjr',
      'h_index',
      'scimago_categories',
      'scimago_source_id',
      'status',
    ]

    const lines = [
      headers.join(','),
      ...results.map((row) => [
        row.doi,
        row.title,
        row.journal,
        row.year,
        row.issns.join('; '),
        row.quartile,
        row.citesDoc2y ?? '',
        row.sjr ?? '',
        row.hIndex ?? '',
        row.categories,
        row.sourceId,
        row.status,
      ].map(csvEscape).join(',')),
    ]

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'scimago-results.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="page">
      <section className="hero">
        <div className="eyebrow">DOI → historical journal metrics</div>
        <h1>Journal Metric Finder</h1>
        <p>
          Paste one or more DOIs. Article metadata come from Crossref and the journal is
          matched by ISSN against historical SCImago Journal & Country Rank data.
        </p>
      </section>

      <section className="panel">
        <label htmlFor="doi-input">DOIs</label>
        <textarea
          id="doi-input"
          rows="7"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="One DOI per line"
        />

        <div className="toolbar">
          <button className="primary" onClick={search} disabled={loading || dois.length === 0}>
            {loading ? 'Searching…' : `Search ${dois.length || ''} DOI${dois.length === 1 ? '' : 's'}`}
          </button>

          {results.length > 0 && (
            <button className="secondary" onClick={exportCsv}>Download CSV</button>
          )}
        </div>

        <div className="datasetStatus">
          SCImago historical data: {manifest.min_year}–{manifest.max_year}.
          {formatRefreshDate(manifest.generated_at) && (
            <> Last automatic refresh: {formatRefreshDate(manifest.generated_at)}.</>
          )}
        </div>
      </section>

      <section className="panel tablePanel">
        {results.length === 0 ? (
          <div className="empty">Search a DOI to retrieve its historical journal metrics.</div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>DOI</th>
                  <th>Article</th>
                  <th>Journal</th>
                  <th>Year</th>
                  <th>ISSN</th>
                  <th>Best Quartile</th>
                  <th>Cites / Doc. (2y)</th>
                  <th>SJR</th>
                  <th>H-index</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={row.doi}>
                    <td><a href={`https://doi.org/${row.doi}`} target="_blank" rel="noreferrer">{row.doi}</a></td>
                    <td>{row.title || '—'}</td>
                    <td>
                      {row.journal || '—'}
                      {row.categories && (
                        <details className="categories">
                          <summary>SCImago categories</summary>
                          <div>{row.categories}</div>
                        </details>
                      )}
                    </td>
                    <td>{row.year || '—'}</td>
                    <td>{row.issns?.length ? row.issns.join(', ') : '—'}</td>
                    <td>
                      {row.quartile
                        ? <span className={quartileClass(row.quartile)}>{row.quartile}</span>
                        : '—'}
                    </td>
                    <td className="metric">{row.citesDoc2y ?? '—'}</td>
                    <td className="metric">{row.sjr ?? '—'}</td>
                    <td className="metric">{row.hIndex ?? '—'}</td>
                    <td>
                      <span className={row.citesDoc2y != null ? 'badge good' : 'badge'}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="note">
        <strong>SCImago metrics shown for the publication year:</strong> Best Quartile (Q1–Q4),
        Cites / Doc. (2 years), SJR and H-index. These are SCImago/Scopus-based metrics and
        are not the proprietary Clarivate Journal Impact Factor (JIF).
      </section>
    </main>
  )
}

export default App
