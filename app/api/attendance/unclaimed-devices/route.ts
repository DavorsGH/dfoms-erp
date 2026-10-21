import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { DEVICES_HUB_ROLES } from "@/utils/rbac-access";

type UnclaimedRow = {
  serial_number: string;
  last_seen_at: string;
};

export async function GET() {
  const auth = await requireTenantRoleIn([...DEVICES_HUB_ROLES]);
  if (!auth.ok) {
    return auth.response;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const admin = createAdminClient();
  const [{ data, error }, { data: claimed, error: claimedError }] =
    await Promise.all([
      admin
        .from("attendance_unclaimed_devices")
        .select("serial_number, last_seen_at")
        .gte("last_seen_at", since)
        .order("last_seen_at", { ascending: false }),
      admin.from("attendance_devices").select("serial_number"),
    ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (claimedError) {
    return NextResponse.json({ error: claimedError.message }, { status: 500 });
  }

  const claimedSerials = new Set(
    ((claimed as { serial_number: string }[] | null) ?? []).map(
      (row) => row.serial_number,
    ),
  );

  const devices = ((data as UnclaimedRow[] | null) ?? [])
    .filter((row) => !claimedSerials.has(row.serial_number))
    .map((row) => ({
      serial_number: row.serial_number,
      last_seen_at: row.last_seen_at,
    }));

  return NextResponse.json({ devices });
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn([...DEVICES_HUB_ROLES]);
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => null)) as
    | { serial_number?: string }
    | null;
  const serial = body?.serial_number?.trim() ?? "";
  if (!serial) {
    return NextResponse.json(
      { error: "Serial number is required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: owned, error: ownedError } = await admin
    .from("attendance_devices")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("serial_number", serial)
    .maybeSingle();

  if (ownedError) {
    return NextResponse.json({ error: ownedError.message }, { status: 500 });
  }
  if (!owned) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error: deleteError } = await admin
    .from("attendance_unclaimed_devices")
    .delete()
    .eq("serial_number", serial);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
