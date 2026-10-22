const PRODUCTION_SUPABASE_REF = "tvcurcnmasnocwdxzgvz";
const STAGING_SUPABASE_REF = "wieflwbfdmjtsdnwbfii";

export type ScannerSimulatorEnv = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
};

/**
 * Staging and local development only.
 * Hidden when this process is the production deployment, or when it is a
 * production build pointed at anything other than the staging project.
 */
export function scannerSimulatorAllowed(
  env: ScannerSimulatorEnv = process.env,
): boolean {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url.includes(PRODUCTION_SUPABASE_REF)) {
    return false;
  }
  if (env.VERCEL_ENV === "production") {
    return false;
  }
  if (env.NODE_ENV === "production" && !url.includes(STAGING_SUPABASE_REF)) {
    return false;
  }
  return true;
}
