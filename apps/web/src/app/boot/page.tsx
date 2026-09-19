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

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const response = await fetch("/api/boot", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { services: Service[]; updatedAt: string };
      if (active) {
        setServices(data.services);
        setUpdatedAt(data.updatedAt);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="boot-dashboard">
      <header className="boot-header">
        <div>
          <p className="eyebrow">LocalScan startup</p>
          <h1>Everything in <em>one screen.</em></h1>
          <p className="boot-subtitle">Service windows are hidden. This dashboard refreshes their output automatically.</p>
        </div>
        <a className="boot-home-link" href="/">Open LocalScan</a>
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
    </main>
  );
}
