import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  computeHubtelBalanceEstimate,
  insertHubtelBalanceLog,
} from "@/utils/hubtel-balance-log";

type InsertBody = {
  amount_ghs?: unknown;
  note?: unknown;
};

export async function GET() {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const admin = createAdminClient();
    const estimate = await computeHubtelBalanceEstimate(admin);
    return NextResponse.json(estimate);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to compute Hubtel balance estimate.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: InsertBody;
  try {
    body = (await request.json()) as InsertBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const amount = Number(body.amount_ghs);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json(
      { error: "amount_ghs must be a non-negative number." },
      { status: 400 },
    );
  }

  const note =
    typeof body.note === "string" ? body.note.trim().slice(0, 2000) : null;

  try {
    const admin = createAdminClient();
    await insertHubtelBalanceLog(admin, {
      amountGhs: amount,
      loggedBy: auth.userId,
      note,
    });
    const estimate = await computeHubtelBalanceEstimate(admin);
    return NextResponse.json(estimate);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to log Hubtel balance.",
      },
      { status: 500 },
    );
  }
}
