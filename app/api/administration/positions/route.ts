import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  formatPositionAddFailedMessage,
  formatPositionDeleteBlockedMessage,
  formatPositionDeleteFailedMessage,
  formatPositionDuplicateTitleMessage,
  resolvePositionDeleteApiErrorMessage,
} from "@/utils/position-delete-errors";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

async function resolveCallerTenantId(): Promise<string | null> {
  return getCurrentUserTenantId();
}

function parsePositionTitle(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }
  return String((body as { position_title?: unknown }).position_title ?? "").trim();
}

export async function POST(request: Request) {
  const tenantId = await resolveCallerTenantId();
  if (!tenantId) {
    return NextResponse.json(
      { error: "Unable to resolve your workspace." },
      { status: 401 },
    );
  }

  let positionTitle = "";
  try {
    positionTitle = parsePositionTitle(await request.json());
  } catch {
    return NextResponse.json(
      { error: "position_title is required." },
      { status: 400 },
    );
  }

  if (!positionTitle) {
    return NextResponse.json(
      { error: "Position title is required." },
      { status: 400 },
    );
  }

  const supabase = await getTenantSupabase();

  const { error: insertError } = await supabase.from("positions").insert({
    tenant_id: tenantId,
    position_title: positionTitle,
  });

  if (insertError) {
    console.error("[positions POST]", insertError);
    const message = (insertError.message ?? "").toLowerCase();
    if (
      insertError.code === "23505" ||
      message.includes("duplicate key") ||
      message.includes("already exists")
    ) {
      return NextResponse.json(
        { error: formatPositionDuplicateTitleMessage(positionTitle) },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: formatPositionAddFailedMessage(positionTitle) },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const tenantId = await resolveCallerTenantId();
  if (!tenantId) {
    return NextResponse.json(
      { error: "Unable to resolve your workspace." },
      { status: 401 },
    );
  }

  let positionTitle = "";
  try {
    positionTitle = parsePositionTitle(await request.json());
  } catch {
    return NextResponse.json(
      { error: "position_title is required." },
      { status: 400 },
    );
  }

  if (!positionTitle) {
    return NextResponse.json(
      { error: "position_title is required." },
      { status: 400 },
    );
  }

  const supabase = await getTenantSupabase();

  const { count, error: countError } = await supabase
    .from("employees")
    .select("employee_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("position", positionTitle);

  if (countError) {
    console.error("[positions DELETE] employee count failed", countError);
    return NextResponse.json(
      { error: formatPositionDeleteFailedMessage(positionTitle) },
      { status: 500 },
    );
  }

  const employeeCount = count ?? 0;
  if (employeeCount > 0) {
    return NextResponse.json(
      {
        error: formatPositionDeleteBlockedMessage(positionTitle, employeeCount),
      },
      { status: 400 },
    );
  }

  const { error: deleteError, count: deletedCount } = await supabase
    .from("positions")
    .delete({ count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("position_title", positionTitle);

  if (deleteError) {
    console.error("[positions DELETE]", deleteError);
    return NextResponse.json(
      {
        error: resolvePositionDeleteApiErrorMessage(positionTitle, deleteError),
      },
      { status: 400 },
    );
  }

  if ((deletedCount ?? 0) === 0) {
    return NextResponse.json(
      { error: formatPositionDeleteFailedMessage(positionTitle) },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true });
}
