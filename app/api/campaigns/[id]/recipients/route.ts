import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Campaign id is required." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // Verify campaign belongs to tenant and load template content.
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select(
      "id, name, channel, status, template_id, message_templates(name, subject, body_email, body_sms, channel)",
    )
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (campaignError) {
    return NextResponse.json(
      { error: campaignError.message },
      { status: 400 },
    );
  }
  if (!campaign) {
    return NextResponse.json(
      { error: "Campaign not found." },
      { status: 404 },
    );
  }

  // Load recipients with embedded customer join.
  // campaign_recipients.customer_id = customers.client_id (text).
  // PostgREST resolves the implicit join via tenant_id + customer_id.
  const { data: recipients, error: recipientsError } = await supabase
    .from("campaign_recipients")
    .select(
      "id, customer_id, channel, status, sent_at, error, customer:customers(client_id, client_name, email, phone)",
    )
    .eq("campaign_id", id)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: true });

  if (recipientsError) {
    return NextResponse.json(
      { error: recipientsError.message },
      { status: 400 },
    );
  }

  // Normalize template join (array or single).
  const rawTemplate = campaign.message_templates;
  const template = Array.isArray(rawTemplate)
    ? rawTemplate[0] ?? null
    : rawTemplate ?? null;

  // Normalize each recipient's customer join.
  const normalizedRecipients = (recipients ?? []).map((row) => {
    const rawCustomer = row.customer;
    const customer = Array.isArray(rawCustomer)
      ? rawCustomer[0] ?? null
      : rawCustomer ?? null;
    return {
      id: row.id,
      customer_id: row.customer_id,
      channel: row.channel,
      status: row.status,
      sent_at: row.sent_at,
      error: row.error,
      customer_name: customer?.client_name ?? row.customer_id,
      email: customer?.email ?? null,
      phone: customer?.phone ?? null,
    };
  });

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      channel: campaign.channel,
      status: campaign.status,
    },
    template: template
      ? {
          name: template.name,
          subject: template.subject ?? null,
          body_email: template.body_email ?? null,
          body_sms: template.body_sms ?? null,
          channel: template.channel,
        }
      : null,
    recipients: normalizedRecipients,
  });
}
