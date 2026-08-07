"use server";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  mapSupabasePasswordError,
  validatePasswordClient,
} from "@/utils/password-policy";
import { recordPasswordUpdatedAt } from "./password-updated-at";

export type UpdatePasswordResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateOwnPassword(
  password: string,
  confirmPassword: string,
): Promise<UpdatePasswordResult> {
  const validationError = validatePasswordClient(password, confirmPassword);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: mapSupabasePasswordError(error) };
  }

  await recordPasswordUpdatedAt(user.id);
  return { ok: true };
}

/** Call after client-side recovery reset (supabase.auth.updateUser) succeeds. */
export async function recordOwnPasswordChanged(): Promise<void> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await recordPasswordUpdatedAt(user.id);
  }
}
