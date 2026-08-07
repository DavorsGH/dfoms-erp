import { resolve } from "node:path";
import pg from "pg";
import { loadEnvForce } from "./env";

export type PgConnectOptions = {
  /** Refuse unless NEXT_PUBLIC_SUPABASE_URL contains this substring (e.g. staging ref). */
  requiredProjectRef?: string;
  envFiles?: string[];
};

function rebuildUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
  return parsed.toString();
}

export function buildPgConnectionCandidates(
  rawUrl: string | undefined,
  supabaseUrl: string,
  extraPassword?: string | null,
) {
  const candidates: string[] = [];
  if (rawUrl) {
    candidates.push(rawUrl, rebuildUrl(rawUrl));
    try {
      const parsed = new URL(rawUrl);
      const password = decodeURIComponent(parsed.password);
      const ref = new URL(supabaseUrl).hostname.split(".")[0];
      for (const region of ["eu-west-1", "eu-north-1"]) {
        candidates.push(
          `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
          `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:6543/postgres`,
        );
      }
      candidates.push(
        `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
      );
    } catch {
      // ignore malformed URL
    }
  }
  const password =
    extraPassword ??
    process.env.SUPABASE_DB_PASSWORD ??
    process.env.DB_PASSWORD ??
    null;
  if (password && supabaseUrl) {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    for (const region of ["eu-west-1", "eu-north-1"]) {
      candidates.push(
        `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
        `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:6543/postgres`,
      );
    }
    candidates.push(
      `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
    );
  }
  return [...new Set(candidates.filter(Boolean))];
}

export async function connectPg(
  options: PgConnectOptions = {},
): Promise<{ client: pg.Client; envFile: string; candidateIndex: number }> {
  const envFiles = options.envFiles ?? [".env.staging.local", ".env.local"];
  let lastError: unknown;

  for (const envFile of envFiles) {
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_DB_PASSWORD;
    delete process.env.DB_PASSWORD;
    try {
      loadEnvForce(resolve(process.cwd(), envFile));
    } catch {
      continue;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (options.requiredProjectRef && !supabaseUrl.includes(options.requiredProjectRef)) {
      continue;
    }

    const candidates = buildPgConnectionCandidates(
      process.env.DATABASE_URL,
      supabaseUrl,
    );
    if (candidates.length === 0) continue;

    for (const [candidateIndex, connectionString] of candidates.entries()) {
      const attempt = new pg.Client({
        connectionString,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
      });
      try {
        await attempt.connect();
        return { client: attempt, envFile, candidateIndex };
      } catch (err) {
        lastError = err;
        try {
          await attempt.end();
        } catch {
          // ignore
        }
      }
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `Could not connect to Postgres: ${lastError.message}`
      : "Could not connect to Postgres (no DATABASE_URL / password?)",
  );
}
