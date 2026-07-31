import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import {
  isLesseeStatus,
  type LesseeListRow,
  type LesseeStatus,
} from "@/app/dashboard/real-estate/lessees-utils";

export type { LesseeListRow, LesseeStatus } from "@/app/dashboard/real-estate/lessees-utils";

type LesseeRow = {
  tenant_id: string;
  lessee_id: string;
  full_name: string;
  email: string | null;
  phone: string;
  status: string;
  private_notes: string | null;
  created_at: string;
  updated_at: string;
};

function mapLessee(row: LesseeRow): LesseeListRow | null {
  if (!isLesseeStatus(row.status)) {
    return null;
  }

  return {
    lesseeId: row.lessee_id,
    tenantId: row.tenant_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    status: row.status,
    privateNotes: row.private_notes,
    createdAt: row.created_at,
  };
}

export async function fetchLesseesForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ rows: LesseeListRow[]; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { rows: [], fetchError: landlord.error };
  }

  const { data, error } = await admin
    .from("lessees")
    .select(
      "tenant_id, lessee_id, full_name, email, phone, status, private_notes, created_at, updated_at",
    )
    .eq("tenant_id", landlord.tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return { rows: [], fetchError: error.message };
  }

  const rows: LesseeListRow[] = [];
  for (const row of (data as LesseeRow[] | null) ?? []) {
    const mapped = mapLessee(row);
    if (mapped) {
      rows.push(mapped);
    }
  }

  return { rows, fetchError: null };
}
