"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  assertLoginAllowed,
  getRequestIp,
  recordFailedLoginAttempt,
} from "@/utils/login-rate-limit";

export type LoginActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Server-side login so Upstash rate limits can run before Supabase Auth and
 * only failed attempts are recorded.
 */
export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginActionResult> {
  const trimmedEmail = email.trim();
  if (!trimmedEmail || !password) {
    return { ok: false, error: "Email and password are required." };
  }

  const headerStore = await headers();
  const ip = getRequestIp(headerStore);

  const allowed = await assertLoginAllowed(trimmedEmail, ip);
  if (!allowed.ok) {
    return allowed;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error) {
    await recordFailedLoginAttempt(trimmedEmail, ip);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
