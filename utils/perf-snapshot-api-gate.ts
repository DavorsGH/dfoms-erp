import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/utils/dashboard-auth";
import { isPerfSnapshotApisEnabled } from "@/utils/perf-probe";

export function perfSnapshotApiDisabledResponse(): NextResponse | null {
  if (!isPerfSnapshotApisEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

export async function perfSnapshotSuperAdminForbiddenResponse(): Promise<NextResponse | null> {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
