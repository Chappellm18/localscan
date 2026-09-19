"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

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

function mapBounds(results: Result[]) {
  const located = results.filter(
    (candidate): candidate is Result & { lat: number; lng: number } =>
      candidate.lat !== null && candidate.lng !== null,
  );
  if (located.length) {
    const latitudes = located.map((candidate) => candidate.lat);
    const longitudes = located.map((candidate) => candidate.lng);
    const latRange = Math.max(Math.max(...latitudes) - Math.min(...latitudes), 0.01);
    const lngRange = Math.max(Math.max(...longitudes) - Math.min(...longitudes), 0.01);
    return {
      minLat: Math.min(...latitudes) - latRange * 0.2,
      maxLat: Math.max(...latitudes) + latRange * 0.2,
      minLng: Math.min(...longitudes) - lngRange * 0.2,
      maxLng: Math.max(...longitudes) + lngRange * 0.2,
    };
  }
  return { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 };
}

function pinPosition(
  result: Result,
  index: number,
  results: Result[],
  bounds = mapBounds(results),
) {
  if (result.lat !== null && result.lng !== null) {
    return {
      left: `${((result.lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100}%`,
      top: `${(1 - (result.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100}%`,
    };
  }
  return { left: `${18 + ((index * 31) % 68)}%`, top: `${22 + ((index * 47) % 58)}%` };
}

export default function Home() {
  const [zip, setZip] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("map");
  const [mapScale, setMapScale] = useState(1);
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
    <main className="landing-page">
      <nav className="site-nav" aria-label="Main navigation">
        <a className="brand" href="/" aria-label="LocalScan home"><span className="brand-mark" aria-hidden="true">L</span>LocalScan</a>
        <span className="nav-note">Local intelligence, made simple.</span>
      </nav>

      {!isReady ? (
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Discover what&apos;s nearby</p>
            <h1 id="hero-title">Find the businesses<br /><em>that matter.</em></h1>
            <p className="hero-description">Enter a ZIP code to uncover local businesses and get a clear view of their online presence.</p>
            <form className="search-form" onSubmit={handleSubmit} noValidate>
              <label htmlFor="zip">Search by ZIP code</label>
              <div className="input-row">
                <input id="zip" inputMode="numeric" maxLength={5} name="zip" onChange={(event) => { setZip(event.target.value.replace(/\D/g, "")); setError(""); }} placeholder="e.g. 10001" value={zip} aria-describedby={error ? "zip-error" : undefined} />
                <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Searching…" : "Search area"}{!isSubmitting && <span aria-hidden="true">→</span>}</button>
              </div>
              {error && <p className="form-message error" id="zip-error" role="alert">{error}</p>}
            </form>
            {jobId && <div className="search-result" role="status" aria-live="polite"><span className="pulse" aria-hidden="true" /><div><strong>{statusLabel}</strong><p>We’re gathering local business information now.</p></div></div>}
          </div>
          <div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="map-card"><span className="map-label label-top">LOCAL</span><span className="map-label label-bottom">SCAN</span><div className="map-grid" /><div className="map-pin"><span /></div><div className="map-card-footer"><span className="map-dot" /><span>Ready to explore</span></div></div></div>
        </section>
      ) : (
        <section className="results-page" aria-labelledby="results-title">
          <div className="results-heading">
            <div><p className="eyebrow">Search results · {zip}</p><h1 id="results-title">Your local <em>landscape.</em></h1><p className="results-summary">{results.length} businesses found near this ZIP code.</p></div>
            <div className="view-toggle" role="group" aria-label="Results view"><button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>Map view</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List view</button></div>
          </div>
          {error && <p className="form-message error" role="alert">{error}</p>}
          {view === "map" ? (
            <div className="results-layout">
              <div className="interactive-map" aria-label="Interactive business map">
                <div className="map-controls"><button onClick={() => setMapScale((scale) => Math.min(2, scale + 0.2))} aria-label="Zoom in">+</button><button onClick={() => setMapScale((scale) => Math.max(0.7, scale - 0.2))} aria-label="Zoom out">−</button></div>
                <div className="map-surface" style={{ transform: `scale(${mapScale})` }}>
                  <div className="map-water" />
                  <div className="map-block block-a" /><div className="map-block block-b" /><div className="map-block block-c" />
                  <div className="map-road road-a" /><div className="map-road road-b" /><div className="map-road road-c" /><div className="map-road road-d" />
                  <span className="map-region region-north">NORTH DISTRICT</span><span className="map-region region-south">DOWNTOWN</span>
                  <div className="zip-boundary" aria-label={`ZIP code ${zip} area`} />
                  {results.map((result, index) => <button key={result.id} className={`result-pin ${selectedId === result.id ? "selected" : ""}`} style={pinPosition(result, index, results)} onClick={() => setSelectedId(result.id)} aria-label={`View ${result.name}`}><span>{index + 1}</span></button>)}
                </div>
                <div className="map-location-label"><strong>{zip}</strong><span>ZIP code area</span></div><div className="map-caption"><span className="map-dot" /> Showing the full ZIP area · Select a pin for details</div>
              </div>
              <ResultPanel result={results.find((result) => result.id === selectedId) ?? results[0]} />
            </div>
          ) : <div className="results-list">{results.map((result, index) => <ResultCard key={result.id} result={result} index={index} />)}</div>}
        </section>
      )}
      <footer className="site-footer"><span>Built for better local discovery.</span><span>One ZIP code at a time.</span></footer>
    </main>
  );
}

function ResultPanel({ result }: { result?: Result }) {
  if (!result) return <aside className="result-panel empty"><strong>No businesses yet</strong><p>Results will appear here as they are discovered.</p></aside>;
  const dimensions = [
    ["Accessibility", result.accessibility_score],
    ["Performance", result.performance_score],
    ["SEO", result.seo_score],
    ["Basics", result.basics_score],
    ["Modernity", result.modernity_score],
  ] as const;
  return <aside className="result-panel"><p className="card-kicker">{result.category ?? "Local business"}</p><h2>{result.name}</h2><p className="result-address">{result.address ?? "Address unavailable"}</p><div className="score-large">{scoreLabel(result.overall_score)}</div><p className="score-note">Overall online presence score</p><div className="score-breakdown">{dimensions.map(([label, score]) => <div className="score-row" key={label}><span>{label}</span><strong>{scoreLabel(score)}</strong><div className="score-track"><i style={{ width: `${score ?? 0}%` }} /></div></div>)}</div>{result.website_url && <a className="website-link" href={result.website_url} target="_blank" rel="noreferrer">Visit website <span>↗</span></a>}</aside>;
}

function ResultCard({ result, index }: { result: Result; index: number }) {
  return <article className="result-card"><span className="list-number">{String(index + 1).padStart(2, "0")}</span><div className="result-card-copy"><p className="card-kicker">{result.category ?? "Local business"}</p><h2>{result.name}</h2><p className="result-address">{result.address ?? "Address unavailable"}</p></div><div className="list-score"><strong>{scoreLabel(result.overall_score)}</strong><span>overall score</span></div></article>;
}
