import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { START_ROTATION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { resolveAuthorizedByFields } from "@/utils/client-invoices-types";
import { loadAuthorizedSignerOptions } from "@/utils/client-invoices-api";
import {
  buildDutyRosterViewModel,
  normalizeDutyRosterEmployee,
  normalizeDutyRosterSite,
  type DutyRosterProject,
  type RosterHistoryRecord,
} from "@/app/dashboard/operations/duty-roster-utils";
import {
  ROSTER_CONFIG_SELECT,
  type RosterConfigRecord,
} from "@/app/dashboard/operations/roster-config-utils";
import { SITE_ASSIGNMENT_SELECT } from "@/app/dashboard/operations/sites-utils";
import {
  PROJECT_SELECT,
  normalizeProjectEntry,
} from "@/app/dashboard/administration/projects-utils";
import {
  getRotationMetadataForClient,
  isRotationApproved,
  normalizeRosterRotationMetadataRecord,
  ROSTER_ROTATION_METADATA_SELECT,
  type RosterRotationMetadataRecord,
} from "@/app/dashboard/operations/roster-rotation-metadata-utils";
import { attachDutyRosterProjectRefs } from "@/utils/duty-roster-employees";

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(START_ROTATION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;
  const cookieStore = await cookies();
  const sessionClient = createClient(cookieStore);

  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    client_id?: string;
    rotation_number?: number;
    approved_by_selection?: string;
    approved_by_other_name?: string;
    approved_by_other_title?: string;
  };

  const clientId = body.client_id?.trim();
  const rotationNumber = Number(body.rotation_number);

  if (!clientId || !Number.isFinite(rotationNumber) || rotationNumber <= 0) {
    return NextResponse.json(
      { error: "Customer and rotation are required." },
      { status: 400 },
    );
  }

  const signersResult = await loadAuthorizedSignerOptions(sessionClient, tenantId);
  if (signersResult.error) {
    return NextResponse.json({ error: signersResult.error }, { status: 500 });
  }

  const approvedBy = resolveAuthorizedByFields(
    body.approved_by_selection?.trim() ?? "",
    body.approved_by_other_name ?? "",
    body.approved_by_other_title ?? "",
    signersResult.signers,
  );

  if (!approvedBy.authorized_by_name?.trim()) {
    return NextResponse.json(
      { error: "Select an approver before approving the roster." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const [
    { data: configRows, error: configError },
    { data: employees, error: employeesError },
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
    { data: history, error: historyError },
    { data: metadataRows, error: metadataError },
  ] = await Promise.all([
    supabase
      .from("roster_config")
      .select(ROSTER_CONFIG_SELECT)
      .eq("tenant_id", tenantId)
      .eq("client_id", clientId)
      .limit(1),
    supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, position, shift, contract_project, employment_status, project_ref:projects!employees_contract_project_fkey(project_code, project_name)",
      )
      .eq("tenant_id", tenantId),
    supabase.from("projects").select(PROJECT_SELECT).eq("tenant_id", tenantId),
    supabase.from("sites").select(SITE_ASSIGNMENT_SELECT).eq("tenant_id", tenantId),
    supabase.from("roster_history").select("*").eq("tenant_id", tenantId),
    supabase
      .from("roster_rotation_metadata")
      .select(ROSTER_ROTATION_METADATA_SELECT)
      .eq("tenant_id", tenantId)
      .eq("client_id", clientId),
  ]);

  if (configError) {
    return NextResponse.json({ error: configError.message }, { status: 500 });
  }
  if (employeesError) {
    return NextResponse.json({ error: employeesError.message }, { status: 500 });
  }
  if (projectsError) {
    return NextResponse.json({ error: projectsError.message }, { status: 500 });
  }
  if (sitesError) {
    return NextResponse.json({ error: sitesError.message }, { status: 500 });
  }
  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 500 });
  }
  if (metadataError) {
    return NextResponse.json({ error: metadataError.message }, { status: 500 });
  }

  const config = (configRows?.[0] as RosterConfigRecord | undefined) ?? null;
  if (!config) {
    return NextResponse.json(
      { error: "Roster configuration not found for this customer." },
      { status: 400 },
    );
  }

  const normalizedProjects =
    ((projects as unknown as DutyRosterProject[] | null) ?? []).map((project) =>
      normalizeProjectEntry(project),
    );
  const normalizedEmployees = attachDutyRosterProjectRefs(
    (
      employees as Array<Parameters<typeof normalizeDutyRosterEmployee>[0]> | null
    )?.map((employee) => normalizeDutyRosterEmployee(employee)) ?? [],
    normalizedProjects,
  );

  const viewModel = buildDutyRosterViewModel({
    clientId,
    clientName: clientId,
    config,
    employees: normalizedEmployees,
    projects: normalizedProjects,
    sites:
      ((sites as unknown as Parameters<typeof normalizeDutyRosterSite>[0][] | null) ??
        []).map((site) => normalizeDutyRosterSite(site)),
    history: (history as RosterHistoryRecord[] | null) ?? [],
  });

  if (rotationNumber !== viewModel.currentRotationNumber) {
    return NextResponse.json(
      {
        error:
          "Only the current rotation can be approved. Switch to the current rotation first.",
      },
      { status: 400 },
    );
  }

  const normalizedMetadata =
    (metadataRows as Partial<RosterRotationMetadataRecord>[] | null)
      ?.map((row) => normalizeRosterRotationMetadataRecord(row))
      .filter((row): row is RosterRotationMetadataRecord => row != null) ?? [];

  const existing = getRotationMetadataForClient(
    normalizedMetadata,
    clientId,
    rotationNumber,
  );

  if (isRotationApproved(existing)) {
    return NextResponse.json(
      { error: "This rotation has already been approved." },
      { status: 400 },
    );
  }

  const approvedAt = new Date().toISOString();
  const payload = {
    tenant_id: tenantId,
    client_id: clientId,
    rotation_number: rotationNumber,
    approved_by_name: approvedBy.authorized_by_name,
    approved_by_title: approvedBy.authorized_by_title,
    approved_by_auth_uid: user.id,
    approved_at: approvedAt,
  };

  const { data: savedRow, error: saveError } = existing
    ? await supabase
        .from("roster_rotation_metadata")
        .update({
          approved_by_name: payload.approved_by_name,
          approved_by_title: payload.approved_by_title,
          approved_by_auth_uid: payload.approved_by_auth_uid,
          approved_at: payload.approved_at,
        })
        .eq("id", existing.id)
        .select(ROSTER_ROTATION_METADATA_SELECT)
        .single()
    : await supabase
        .from("roster_rotation_metadata")
        .insert(payload)
        .select(ROSTER_ROTATION_METADATA_SELECT)
        .single();

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  return NextResponse.json({
    message: "Duty roster approved.",
    metadata: normalizeRosterRotationMetadataRecord(
      savedRow as Partial<RosterRotationMetadataRecord>,
    ),
  });
}
