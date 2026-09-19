"use client";

import { useEffect, useState } from "react";

type Service = {
  id: string;
  label: string;
  running: boolean;
  output: string;
  error: string;
};

export default function BootDashboard() {
  const [services, setServices] = useState<Service[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [stopping, setStopping] = useState(false);
  const [stopMessage, setStopMessage] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/boot", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Boot status request failed (${response.status}).`);
        }
        const data = (await response.json()) as { services: Service[]; updatedAt: string };
        if (active) {
          setServices(data.services);
          setUpdatedAt(data.updatedAt);
          setRefreshError("");
        }
      } catch (error) {
        if (active) {
          setRefreshError(error instanceof Error ? error.message : "Unable to refresh service status.");
        }
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const stopAllSessions = async () => {
    if (!window.confirm("Stop all LocalScan sessions so you can reboot?")) return;

    setStopping(true);
    setStopMessage("");
    try {
      const response = await fetch("/api/boot", { method: "POST" });
      const data = (await response.json()) as {
        stopped: string[];
        failed: { id: string; error: string }[];
      };
      if (!response.ok) throw new Error("The sessions could not be stopped.");
      setStopMessage(
        data.failed.length === 0
          ? "All sessions stopped. You can reboot now."
          : `Stopped ${data.stopped.length} sessions; ${data.failed.length} could not be stopped.`,
      );
    } catch (error) {
      setStopMessage(error instanceof Error ? error.message : "The sessions could not be stopped.");
    } finally {
      setStopping(false);
    }
  };

  return (
    <main className="boot-dashboard">
      <header className="boot-header">
        <div>
          <p className="eyebrow">LocalScan startup</p>
          <h1>Everything in <em>one screen.</em></h1>
          <p className="boot-subtitle">Service windows are hidden. This dashboard refreshes their output automatically.</p>
        </div>
        <div className="boot-actions">
          <a className="boot-home-link" href="/">Open LocalScan</a>
          <button className="boot-stop-button" disabled={stopping} onClick={stopAllSessions} type="button">
            {stopping ? "Stopping sessions…" : "Kill all sessions"}
          </button>
        </div>
      </header>
      <div className="service-grid">
        {services.map((service) => (
          <section className="service-card" key={service.id}>
            <div className="service-card-header">
              <div><span className={`service-dot ${service.running ? "online" : "offline"}`} /><strong>{service.label}</strong></div>
              <span className={service.running ? "service-status online-text" : "service-status"}>{service.running ? "Running" : "Stopped"}</span>
            </div>
            <pre>{service.output || service.error || "Waiting for output…"}</pre>
            {service.error && service.output && <details><summary>stderr</summary><pre>{service.error}</pre></details>}
          </section>
        ))}
      </div>
      <p className="boot-updated">Last checked {updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"}</p>
      {refreshError && <p className="boot-stop-message" role="alert">{refreshError} Retrying…</p>}
      {stopMessage && <p className="boot-stop-message" role="status">{stopMessage}</p>}
    </main>
  );
}
