"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type JobStatus = {
  status?: string;
  [key: string]: string | undefined;
};

export default function Home() {
  const [zip, setZip] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedZip = zip.trim();

    if (!/^\d{5}$/.test(normalizedZip)) {
      setError("Enter a valid 5-digit ZIP code.");
      return;
    }

    setError("");
    setStatus(null);
    setJobId(null);
    eventSourceRef.current?.close();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/jobs/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip: normalizedZip }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "We couldn’t start that search.");
      }

      setJobId(data.jobId);
      const eventSource = new EventSource(`/api/jobs/${data.jobId}/stream`);
      eventSourceRef.current = eventSource;
      eventSource.addEventListener("status", (message) => {
        setStatus(JSON.parse(message.data) as JobStatus);
      });
      eventSource.addEventListener("error", () => {
        eventSource.close();
      });
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "We couldn’t start that search.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const statusLabel =
    status?.status === "completed"
      ? "Search complete"
      : status?.status === "failed"
        ? "Search couldn’t be completed"
        : "Search queued";

  return (
    <main className="landing-page">
      <nav className="site-nav" aria-label="Main navigation">
        <a className="brand" href="/" aria-label="LocalScan home">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          LocalScan
        </a>
        <span className="nav-note">Local intelligence, made simple.</span>
      </nav>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Discover what&apos;s nearby</p>
          <h1 id="hero-title">
            Find the businesses
            <br />
            <em>that matter.</em>
          </h1>
          <p className="hero-description">
            Enter a ZIP code to uncover local businesses and get a clear view
            of their online presence.
          </p>

          <form className="search-form" onSubmit={handleSubmit} noValidate>
            <label htmlFor="zip">Search by ZIP code</label>
            <div className="input-row">
              <input
                id="zip"
                inputMode="numeric"
                maxLength={5}
                name="zip"
                onChange={(event) => {
                  setZip(event.target.value.replace(/\D/g, ""));
                  setError("");
                }}
                placeholder="e.g. 10001"
                value={zip}
                aria-describedby={error ? "zip-error" : undefined}
              />
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Searching…" : "Search area"}
                {!isSubmitting && <span aria-hidden="true">→</span>}
              </button>
            </div>
            {error && (
              <p className="form-message error" id="zip-error" role="alert">
                {error}
              </p>
            )}
          </form>

          {jobId && (
            <div className="search-result" role="status" aria-live="polite">
              <span className="pulse" aria-hidden="true" />
              <div>
                <strong>{statusLabel}</strong>
                <p>
                  {status?.status === "completed"
                    ? "Your local business results are ready."
                    : "We’re gathering local business information now."}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="hero-art" aria-hidden="true">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="map-card">
            <span className="map-label label-top">LOCAL</span>
            <span className="map-label label-bottom">SCAN</span>
            <div className="map-grid" />
            <div className="map-pin">
              <span />
            </div>
            <div className="map-card-footer">
              <span className="map-dot" />
              <span>Ready to explore</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span>Built for better local discovery.</span>
        <span>One ZIP code at a time.</span>
      </footer>
    </main>
  );
}
