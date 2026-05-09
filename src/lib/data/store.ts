import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CleanupRun } from "@/lib/types";

function getDataDir() {
  return path.join(process.cwd(), "data");
}

function getCleanupRunsFile() {
  return path.join(getDataDir(), "cleanup-runs.json");
}

async function ensureDataFiles() {
  const dataDir = getDataDir();
  await mkdir(dataDir, { recursive: true });

  try {
    await readFile(getCleanupRunsFile(), "utf8");
  } catch {
    await writeFile(getCleanupRunsFile(), "[]\n", "utf8");
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  await ensureDataFiles();
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJsonFile(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function getCleanupRuns() {
  return readJsonFile<CleanupRun[]>(getCleanupRunsFile());
}

export async function getCleanupRunById(id: string) {
  const runs = await getCleanupRuns();
  return runs.find((run) => run.id === id) ?? null;
}

export async function getLatestCleanupRun() {
  const runs = await getCleanupRuns();
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export async function saveCleanupRun(run: CleanupRun) {
  const runs = await getCleanupRuns();
  const existingIndex = runs.findIndex((item) => item.id === run.id);

  if (existingIndex >= 0) {
    runs[existingIndex] = run;
  } else {
    runs.unshift(run);
  }

  await writeJsonFile(getCleanupRunsFile(), runs);
  return run;
}

export async function resetCleanupRuns() {
  await ensureDataFiles();
  await writeJsonFile(getCleanupRunsFile(), []);
}
