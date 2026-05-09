import { writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");

await writeFile(path.join(dataDir, "cleanup-runs.json"), "[]\n", "utf8");

console.log("CRM Autopilot cleanup run history reset.");
