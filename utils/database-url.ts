import "server-only";

/** Resolve a Postgres connection string for server-side transactional jobs. */
export function resolveDatabaseUrl(): string | null {
  const explicit =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL;

  if (explicit) {
    return explicit;
  }

  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!password || !supabaseUrl) {
    return null;
  }

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const encodedPassword = encodeURIComponent(password);

  return `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`;
}
