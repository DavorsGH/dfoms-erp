import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  isTerminalSupportTicketStatus,
  type SupportTicketStatus,
} from "@/utils/support-tickets-types";

type UpdateSupportTicketBody = {
  ticket_id?: string;
  status?: SupportTicketStatus;
  resolution_notes?: string | null;
};

const VALID_STATUSES: readonly SupportTicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateSupportTicketBody;
  try {
    body = (await request.json()) as UpdateSupportTicketBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ticketId = body.ticket_id?.trim() ?? "";
  const status = body.status;
  const resolutionNotes =
    body.resolution_notes === undefined
      ? undefined
      : body.resolution_notes?.trim() || null;

  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Valid status is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existing, error: lookupError } = await admin
    .from("support_tickets")
    .select("id, status")
    .eq("id", ticketId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const updatePayload: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (resolutionNotes !== undefined) {
    updatePayload.resolution_notes = resolutionNotes;
  }

  if (isTerminalSupportTicketStatus(status)) {
    updatePayload.resolved_by = auth.userId;
    updatePayload.resolved_at = new Date().toISOString();
  } else {
    updatePayload.resolved_by = null;
    updatePayload.resolved_at = null;
  }

  const { data: ticket, error: updateError } = await admin
    .from("support_tickets")
    .update(updatePayload)
    .eq("id", ticketId)
    .select(
      "id, tenant_id, submitted_by, subject, description, status, resolution_notes, resolved_by, resolved_at, created_at, updated_at",
    )
    .single();

  if (updateError || !ticket) {
    return NextResponse.json(
      { error: updateError?.message ?? "Unable to update ticket." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ticket });
}
