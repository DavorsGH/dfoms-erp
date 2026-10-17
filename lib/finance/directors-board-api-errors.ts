import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  extractPostgresUniqueConstraintName,
  isPostgresForeignKeyViolation,
  isPostgresUniqueViolation,
} from "@/utils/postgres-fk-violation";

export const DIRECTORS_GENERIC_SAVE_ERROR =
  "Something went wrong saving this. Please try again.";

export const DIRECTORS_GENERIC_ACTION_ERROR =
  "Something went wrong. Please try again.";

export const TENANT_SHAREHOLDERS_TENANT_NAME_UIDX =
  "tenant_shareholders_tenant_name_uidx";

function isPostgresSystemError(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!error) {
    return false;
  }
  if (error.code && /^[23]/.test(error.code)) {
    return true;
  }
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("violates") ||
    message.includes("duplicate key") ||
    message.includes("postgres")
  );
}

export function logDirectorsBoardPostgrestError(
  context: string,
  error:
    | Pick<PostgrestError, "code" | "message"> & Partial<Pick<PostgrestError, "details">>
    | null
    | undefined,
): void {
  if (error) {
    console.error(`[directors-board:${context}]`, {
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }
}

export function clientMessageForDirectorsPostgrestError(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
  context: string,
  fallback = DIRECTORS_GENERIC_SAVE_ERROR,
): string {
  logDirectorsBoardPostgrestError(context, error);
  return fallback;
}

export function shareholderNameDuplicateResponse(fullName: string): NextResponse {
  const name = fullName.trim() || "This name";
  return NextResponse.json(
    { error: `A shareholder named ${name} is already on the register.` },
    { status: 409 },
  );
}

export function responseForShareholderWriteError(
  error: PostgrestError | null | undefined,
  fullName: string,
  context: string,
): NextResponse {
  if (isPostgresUniqueViolation(error)) {
    const constraint =
      extractPostgresUniqueConstraintName(error?.message ?? "") ??
      ((error?.message ?? "").includes(TENANT_SHAREHOLDERS_TENANT_NAME_UIDX)
        ? TENANT_SHAREHOLDERS_TENANT_NAME_UIDX
        : null);
    if (constraint === TENANT_SHAREHOLDERS_TENANT_NAME_UIDX) {
      logDirectorsBoardPostgrestError(context, error);
      return shareholderNameDuplicateResponse(fullName);
    }
  }

  return NextResponse.json(
    {
      error: clientMessageForDirectorsPostgrestError(error, context),
    },
    { status: 500 },
  );
}

export function responseForDirectorsPostgrestError(
  error: PostgrestError | null | undefined,
  context: string,
  options?: { fallback?: string; status?: number },
): NextResponse {
  return NextResponse.json(
    {
      error: clientMessageForDirectorsPostgrestError(
        error,
        context,
        options?.fallback ?? DIRECTORS_GENERIC_SAVE_ERROR,
      ),
    },
    { status: options?.status ?? 500 },
  );
}

/** Dividend atomic RPC errors are plain English; Postgres system errors are sanitized. */
export function dividendRpcClientErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): string {
  const message = error?.message?.trim();
  if (!message) {
    return DIRECTORS_GENERIC_ACTION_ERROR;
  }
  if (isPostgresSystemError(error)) {
    logDirectorsBoardPostgrestError("dividend-rpc", error);
    return DIRECTORS_GENERIC_ACTION_ERROR;
  }
  if (isPostgresForeignKeyViolation(error) || isPostgresUniqueViolation(error)) {
    logDirectorsBoardPostgrestError("dividend-rpc", error);
    return DIRECTORS_GENERIC_ACTION_ERROR;
  }
  return message;
}

export function clientMessageForDirectorsLoadError(
  message: string | null | undefined,
  context: string,
): string {
  if (!message?.trim()) {
    return DIRECTORS_GENERIC_ACTION_ERROR;
  }
  if (
    message.toLowerCase().includes("violates") ||
    message.toLowerCase().includes("duplicate key")
  ) {
    console.error(`[directors-board:${context}]`, message);
    return DIRECTORS_GENERIC_ACTION_ERROR;
  }
  return message;
}
