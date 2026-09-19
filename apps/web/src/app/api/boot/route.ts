import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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

export async function GET() {
  const bootRoot = path.resolve(process.cwd(), "..", "..", ".localscan", "boot");
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
