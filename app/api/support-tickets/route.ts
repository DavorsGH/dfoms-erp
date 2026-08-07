import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { notifySupportTicketSubmitted } from "@/utils/support-ticket-notifications";
import type { SupportTicketRow } from "@/utils/support-tickets-types";

type CreateSupportTicketBody = {
  subject?: string;
  description?: string;
};

const MAX_SUBJECT_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 8000;

export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateSupportTicketBody;
  try {
    body = (await request.json()) as CreateSupportTicketBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const subject = body.subject?.trim() ?? "";
  const description = body.description?.trim() ?? "";

  if (!subject) {
    return NextResponse.json({ error: "Subject is required." }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json({ error: "Description is required." }, { status: 400 });
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return NextResponse.json(
      { error: `Subject must be at most ${MAX_SUBJECT_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { error: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const { data: ticket, error } = await supabase
    .from("support_tickets")
    .insert({
      tenant_id: auth.tenantId,
      submitted_by: user.id,
      subject,
      description,
      status: "open",
    })
    .select(
      "id, tenant_id, submitted_by, subject, description, status, resolution_notes, resolved_by, resolved_at, created_at, updated_at",
    )
    .single();

  if (error || !ticket) {
    return NextResponse.json(
      { error: error?.message ?? "Unable to create support ticket." },
      { status: 500 },
    );
  }

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", auth.tenantId)
    .maybeSingle();

  void notifySupportTicketSubmitted({
    ticketId: (ticket as SupportTicketRow).id,
    tenantName: tenant?.name?.trim() || "Unknown tenant",
    subject,
  });

  return NextResponse.json({ ticket: ticket as SupportTicketRow });
}
