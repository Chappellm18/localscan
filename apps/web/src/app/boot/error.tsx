"use client";

type BootErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function BootError({ error, reset }: BootErrorProps) {
  return (
    <main className="boot-dashboard">
      <p className="eyebrow">LocalScan startup</p>
      <h1>Unable to load the startup dashboard.</h1>
      <p className="boot-subtitle">
        {error.message || "The boot page encountered an unexpected error."}
      </p>
      <button className="boot-stop-button" onClick={reset} type="button">
        Try again
      </button>
    </main>
  );
}
