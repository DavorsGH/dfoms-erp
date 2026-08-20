import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  loadGeneratedInvoicesForContract,
  loadServiceContractDetail,
  updateServiceContract,
} from "@/utils/service-contracts-api";
import {
  validateServiceContractBody,
  type ServiceContractWriteBody,
} from "@/utils/service-contracts-types";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { createTenantLogosSignedUrl } from "@/utils/tenant-logos-storage";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function rejectClientTenantId(body: unknown): NextResponse | null {
  if (body !== null && typeof body === "object" && "tenant_id" in body) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client" },
      { status: 400 },
    );
  }

  return null;
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const detail = await loadServiceContractDetail(supabase, auth.tenantId, id);
  if (detail.error || !detail.contract) {
    return NextResponse.json(
      { error: detail.error ?? "Service contract not found." },
      { status: 404 },
    );
  }

  const [{ invoices, error: invoicesError }] = await Promise.all([
    loadGeneratedInvoicesForContract(supabase, auth.tenantId, id),
  ]);

  let documentSignedUrl: string | null = null;
  const documentPath = detail.contract.document_url?.trim();
  if (documentPath) {
    const admin = createAdminClient();
    documentSignedUrl =
      (await createTenantLogosSignedUrl(admin, documentPath)) ?? documentPath;
  }

  return NextResponse.json({
    service_contract: detail.contract,
    line_items: detail.line_items,
    generated_invoices: invoices,
    document_signed_url: documentSignedUrl,
    fetch_warnings: invoicesError ? [invoicesError] : [],
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tenantRejection = rejectClientTenantId(rawBody);
  if (tenantRejection) {
    return tenantRejection;
  }

  const body = rawBody as ServiceContractWriteBody;
  const validationError = validateServiceContractBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const existing = await loadServiceContractDetail(supabase, auth.tenantId, id);
  if (existing.error || !existing.contract) {
    return NextResponse.json(
      { error: existing.error ?? "Service contract not found." },
      { status: 404 },
    );
  }

  const { contract, error } = await updateServiceContract(
    supabase,
    auth.tenantId,
    id,
    body,
    existing.contract.contract_sequence,
    existing.contract.contract_number,
  );

  if (error || !contract) {
    return NextResponse.json(
      { error: error ?? "Unable to update service contract." },
      { status: 400 },
    );
  }

  return NextResponse.json({ service_contract: contract });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error } = await supabase
    .from("service_contracts")
    .delete()
    .eq("id", id)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
