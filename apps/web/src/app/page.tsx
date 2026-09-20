"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const BusinessMap = dynamic(() => import("./components/BusinessMap"), {
  ssr: false,
  loading: () => <div className="interactive-map map-loading">Loading OpenStreetMap…</div>,
});

type JobStatus = { status?: string; [key: string]: string | undefined };
type Result = {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  phone: string | null;
  website_url: string | null;
  lat: number | null;
  lng: number | null;
  overall_score: number | null;
  accessibility_score: number | null;
  performance_score: number | null;
  seo_score: number | null;
  basics_score: number | null;
  modernity_score: number | null;
};

type ViewMode = "map" | "list";

function scoreLabel(score: number | null) {
  return score === null ? "Not scored" : `${Math.round(score)}/100`;
}

export default function Home() {
  const [zip, setZip] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("map");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const terminalStatusRef = useRef(false);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  async function loadResults(id: string) {
    const response = await fetch(`/api/jobs/${id}/results`);
    if (!response.ok) throw new Error("Results could not be loaded.");
    const data = (await response.json()) as { results: Result[] };
    setResults(data.results);
    setSelectedId(data.results[0]?.id ?? null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedZip = zip.trim();
    if (!/^\d{5}$/.test(normalizedZip)) {
      setError("Enter a valid 5-digit ZIP code.");
      return;
    }

    setError("");
    setStatus(null);
    setResults([]);
    setSelectedId(null);
    setJobId(null);
    eventSourceRef.current?.close();
    terminalStatusRef.current = false;
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/jobs/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip: normalizedZip }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We couldn’t start that search.");

      setJobId(data.jobId);
      const eventSource = new EventSource(`/api/jobs/${data.jobId}/stream`);
      eventSourceRef.current = eventSource;
      eventSource.addEventListener("status", async (message) => {
        const nextStatus = JSON.parse(message.data) as JobStatus;
        setStatus(nextStatus);
        if (nextStatus.status === "completed") {
          terminalStatusRef.current = true;
          try {
            await loadResults(data.jobId);
          } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Results could not be loaded.");
          }
        } else if (nextStatus.status === "failed") {
          terminalStatusRef.current = true;
          setError(nextStatus.error ?? "We couldn’t complete that search.");
        }
      });
      eventSource.addEventListener("error", () => {
        if (!terminalStatusRef.current) {
          setError("The search connection was interrupted. Please try again.");
        }
        eventSource.close();
      });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "We couldn’t start that search.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isReady = status?.status === "completed";
  const statusLabel = isReady
    ? "Search complete"
    : status?.status === "failed"
      ? "Search couldn’t be completed"
      : "Search queued";

  return (
    <main className={`landing-page${isReady ? " results-mode" : ""}`}>
      <nav className="site-nav" aria-label="Main navigation">
        <a className="brand" href="/" aria-label="LocalScan home"><span className="brand-mark" aria-hidden="true">L</span>LocalScan</a>
        <span className="nav-note">Lead generation for local websites.</span>
      </nav>

      {!isReady ? (
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Discover nearby businesses</p>
            <h1 id="hero-title">Find the local shops<br /><em>most likely to need help.</em></h1>
            <p className="hero-description">Search a ZIP code to spot businesses with weak digital presence, outdated sites, and promising sales opportunities.</p>
            <form className="search-form" onSubmit={handleSubmit} noValidate>
              <label htmlFor="zip">Search by ZIP code</label>
              <div className="input-row">
                <input id="zip" inputMode="numeric" maxLength={5} name="zip" onChange={(event) => { setZip(event.target.value.replace(/\D/g, "")); setError(""); }} placeholder="e.g. 10001" value={zip} aria-describedby={error ? "zip-error" : undefined} />
                <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Searching…" : "Search area"}{!isSubmitting && <span aria-hidden="true">→</span>}</button>
              </div>
              {error && <p className="form-message error" id="zip-error" role="alert">{error}</p>}
            </form>
            {jobId && <div className="search-result" role="status" aria-live="polite"><span className="pulse" aria-hidden="true" /><div><strong>{statusLabel}</strong><p>We’re gathering local business details and website-fit signals now.</p></div></div>}
          </div>
          <div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="map-card"><span className="map-label label-top">LOCAL</span><span className="map-label label-bottom">LEADS</span><div className="map-grid" /><div className="map-pin"><span /></div><div className="map-card-footer"><span className="map-dot" /><span>Ready to target</span></div></div></div>
        </section>
      ) : (
        <section className="results-page" aria-labelledby="results-title">
          <div className="results-heading">
            <div><p className="eyebrow">Lead targets · {zip}</p><h1 id="results-title">Your local <em>opportunity map.</em></h1><p className="results-summary">{results.length} businesses found near this ZIP code with lead potential.</p></div>
            <div className="view-toggle" role="group" aria-label="Results view"><button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>Map view</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List view</button></div>
          </div>
          {error && <p className="form-message error" role="alert">{error}</p>}
          {view === "map" ? (
            <div className="results-layout">
              <aside className="results-sidebar" aria-label="Businesses in search area">
                <p className="sidebar-label">Businesses</p>
                <div className="results-sidebar-list">
                  {results.map((result, index) => (
                    <ResultCard
                      key={result.id}
                      index={index}
                      result={result}
                      selected={result.id === selectedId}
                      onSelect={setSelectedId}
                    />
                  ))}
                </div>
                <ResultPanel result={results.find((result) => result.id === selectedId) ?? results[0]} />
              </aside>
              <div className="map-pane" aria-label="Interactive OpenStreetMap business map">
                <BusinessMap
                  results={results}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  zip={zip}
                />
              </div>
            </div>
          ) : <div className="results-list">{results.map((result, index) => <ResultCard key={result.id} result={result} index={index} />)}</div>}
        </section>
      )}
      <footer className="site-footer"><span>Built for local sales leads.</span><span>One ZIP code at a time.</span></footer>
    </main>
  );
}

function ResultPanel({ result }: { result?: Result }) {
  if (!result) return <aside className="result-panel empty"><strong>No businesses yet</strong><p>Results will appear here as they are discovered.</p></aside>;
  const dimensions = [
    ["Accessibility gaps", result.accessibility_score],
    ["Performance gaps", result.performance_score],
    ["SEO gaps", result.seo_score],
    ["Brand basics", result.basics_score],
    ["Modernity gaps", result.modernity_score],
  ] as const;

  return (
    <aside className="result-panel">
      <p className="card-kicker">{result.category ?? "Local business"}</p>
      <h2>{result.name}</h2>
      <div className="result-meta">
        {result.address && <p><strong>Address:</strong> {result.address}</p>}
        {result.phone && <p><strong>Phone:</strong> {result.phone}</p>}
      </div>
      <div className="score-large">{scoreLabel(result.overall_score)}</div>
      <p className="score-note">Lead opportunity score</p>
      <p className="score-summary">Higher score means the business looks more likely to need a new website or software stack.</p>
      <div className="score-breakdown">
        {dimensions.map(([label, score]) => (
          <div className="score-row" key={label}>
            <span>{label}</span>
            <strong>{scoreLabel(score)}</strong>
            <div className="score-track"><i style={{ width: `${score ?? 0}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="result-links">
        {result.website_url ? (
          <a className="website-link" href={result.website_url} target="_blank" rel="noreferrer">Visit website <span>↗</span></a>
        ) : (
          <span className="website-link muted">No website found</span>
        )}
      </div>
    </aside>
  );
}

function ResultCard({
  result,
  index,
  selected = false,
  onSelect,
}: {
  result: Result;
  index: number;
  selected?: boolean;
  onSelect?: (id: string) => void;
}) {
  return <article
    aria-current={selected ? "true" : undefined}
    className={`result-card${selected ? " selected" : ""}`}
    onClick={() => onSelect?.(result.id)}
    onKeyDown={(event) => {
      if (onSelect && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        onSelect(result.id);
      }
    }}
    role={onSelect ? "button" : undefined}
    tabIndex={onSelect ? 0 : undefined}
  ><span className="list-number">{String(index + 1).padStart(2, "0")}</span><div className="result-card-copy"><p className="card-kicker">{result.category ?? "Local business"}</p><h2>{result.name}</h2><p className="result-address">{result.address ?? "Address unavailable"}</p></div><div className="list-score"><strong>{scoreLabel(result.overall_score)}</strong><span>overall score</span></div></article>;
}
