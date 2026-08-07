import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

export function resolveEnvFile(argv: string[], fallback = ".env.staging.local") {
  const idx = argv.indexOf("--env-file");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return fallback;
}

export function loadEnvFromArgv(argv: string[]) {
  const envFile = resolveEnvFile(argv);
  loadEnvForce(resolve(process.cwd(), envFile));
  return envFile;
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
