import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const services = [
  { id: "web", label: "Web app", log: "web.log", errorLog: "web.error.log" },
  { id: "discovery", label: "Discovery worker", log: "discovery.log", errorLog: "discovery.error.log" },
  { id: "scoring", label: "Scoring worker", log: "scoring.log", errorLog: "scoring.error.log" },
  { id: "dependencies", label: "Dependencies", log: "dependencies.log", errorLog: "dependencies.error.log" },
];

function readText(filePath: string) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8").slice(-12000) : "";
}

function isRunning(pidPath: string) {
  if (!existsSync(pidPath)) return false;
  const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(pidPath: string) {
  if (!existsSync(pidPath)) return null;
  const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  return Number.isInteger(pid) ? pid : null;
}

function getBootRoot() {
  const configuredRoot = process.env.LOCALSCAN_BOOT_ROOT;
  if (configuredRoot) return configuredRoot;

  const candidates = [
    path.resolve(process.cwd(), ".localscan", "boot"),
    path.resolve(process.cwd(), "..", "..", ".localscan", "boot"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function stopProcess(pid: number) {
  return new Promise<void>((resolve, reject) => {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function GET() {
  const bootRoot = getBootRoot();
  return NextResponse.json({
    services: services.map((service) => ({
      ...service,
      running: isRunning(path.join(bootRoot, `${service.id}.pid`)),
      output: readText(path.join(bootRoot, service.log)),
      error: readText(path.join(bootRoot, service.errorLog)),
    })),
    updatedAt: new Date().toISOString(),
  });
}

export async function POST() {
  const bootRoot = getBootRoot();
  const processes = services
    .map((service) => ({
      id: service.id,
      pid: readPid(path.join(bootRoot, `${service.id}.pid`)),
    }))
    .filter((service): service is { id: string; pid: number } => service.pid !== null);

  const results = [];
  for (const service of processes.filter((service) => service.id !== "web")) {
    try {
      await stopProcess(service.pid);
      results.push({ id: service.id, stopped: true });
    } catch (error) {
      results.push({
        id: service.id,
        stopped: false,
        error: error instanceof Error ? error.message : "Unable to stop process",
      });
    }
  }

  const webProcess = processes.find((service) => service.id === "web");
  if (webProcess) {
    setTimeout(() => {
      void stopProcess(webProcess.pid).catch((error) => {
        console.error(`Unable to stop web process ${webProcess.pid}:`, error);
      });
    }, 250);
    results.push({ id: webProcess.id, stopped: true });
  }

  return NextResponse.json({
    stopped: results.filter((result) => result.stopped).map((result) => result.id),
    failed: results
      .filter((result) => !result.stopped)
      .map(({ id, error }) => ({ id, error })),
  });
}
