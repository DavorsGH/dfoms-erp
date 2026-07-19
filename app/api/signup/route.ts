import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  addTrialDays,
  buildUniqueSlugCandidates,
  DAVORS_TENANT_ID,
  ERP_SUITE_CUSTOMER_STATUS,
  ERP_SUITE_CUSTOMER_TYPE,
  ERP_SUITE_SIGNUP_SOURCE,
  ERP_SUITE_SUBSCRIPTION_STATUS,
  ERP_SUITE_TRIAL_DAYS,
  generateNextCustomerClientId,
  isDuplicateClientIdError,
  isDuplicateEmailError,
  isDuplicateSlugError,
  slugifyCompanyName,
  validateSignupInput,
  type SignupRequestBody,
} from "@/utils/tenant-signup";

type SignupRollbackState = {
  authUserId: string | null;
  tenantId: string | null;
  clientId: string | null;
  subscriptionId: string | null;
};

async function rollbackSignup(
  admin: ReturnType<typeof createAdminClient>,
  state: SignupRollbackState,
) {
  if (state.subscriptionId) {
    await admin.from("crm_subscriptions").delete().eq("id", state.subscriptionId);
  }

  if (state.clientId) {
    await admin
      .from("customers")
      .delete()
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("client_id", state.clientId);
  }

  if (state.authUserId) {
    await admin.from("user_accounts").delete().eq("auth_uid", state.authUserId);
    await admin.auth.admin.deleteUser(state.authUserId);
  }

  if (state.tenantId) {
    await admin.from("tenants").delete().eq("id", state.tenantId);
  }
}

async function resolveAvailableSlug(
  admin: ReturnType<typeof createAdminClient>,
  companyName: string,
): Promise<string | null> {
  const baseSlug = slugifyCompanyName(companyName);
  const candidates = buildUniqueSlugCandidates(baseSlug);

  const { data: existingRows, error } = await admin
    .from("tenants")
    .select("slug")
    .in("slug", candidates);

  if (error) {
    return null;
  }

  const taken = new Set((existingRows ?? []).map((row) => row.slug));
  return candidates.find((candidate) => !taken.has(candidate)) ?? null;
}

export async function POST(request: Request) {
  let body: SignupRequestBody;

  try {
    body = (await request.json()) as SignupRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const validation = validateSignupInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { companyName, adminFullName, adminEmail, password } = validation.data;
  const admin = createAdminClient();
  const rollbackState: SignupRollbackState = {
    authUserId: null,
    tenantId: null,
    clientId: null,
    subscriptionId: null,
  };

  const slug = await resolveAvailableSlug(admin, companyName);
  if (!slug) {
    return NextResponse.json(
      { error: "Unable to verify company availability. Please try again." },
      { status: 503 },
    );
  }

  const { data: existingCustomers, error: customersLookupError } = await admin
    .from("customers")
    .select("client_id")
    .eq("tenant_id", DAVORS_TENANT_ID);

  if (customersLookupError) {
    return NextResponse.json(
      { error: customersLookupError.message },
      { status: 503 },
    );
  }

  const clientId = generateNextCustomerClientId(
    (existingCustomers ?? []).map((row) => row.client_id),
  );

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: adminFullName,
      company_name: companyName,
    },
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      {
        error: isDuplicateEmailError(authError?.message ?? "")
          ? "An account with this email already exists."
          : (authError?.message ?? "Failed to create auth user."),
      },
      { status: 400 },
    );
  }

  rollbackState.authUserId = authData.user.id;

  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .insert({
      name: companyName,
      slug,
      status: "active",
    })
    .select("id")
    .single();

  if (tenantError || !tenantRow) {
    await rollbackSignup(admin, rollbackState);
    return NextResponse.json(
      {
        error: isDuplicateSlugError(tenantError?.message ?? "")
          ? "This company name is already registered. Try a different name."
          : (tenantError?.message ?? "Failed to create tenant."),
      },
      { status: 400 },
    );
  }

  rollbackState.tenantId = tenantRow.id;

  const { error: userAccountError } = await admin.from("user_accounts").insert({
    auth_uid: authData.user.id,
    tenant_id: tenantRow.id,
    role: "super_admin",
    employee_id: null,
    client_id: null,
    email: adminEmail,
    is_active: true,
  });

  if (userAccountError) {
    await rollbackSignup(admin, rollbackState);
    return NextResponse.json({ error: userAccountError.message }, { status: 400 });
  }

  const { error: customerError } = await admin.from("customers").insert({
    tenant_id: DAVORS_TENANT_ID,
    client_id: clientId,
    client_name: companyName,
    contact_person: adminFullName,
    email: adminEmail,
    customer_type: ERP_SUITE_CUSTOMER_TYPE,
    source: ERP_SUITE_SIGNUP_SOURCE,
    status: ERP_SUITE_CUSTOMER_STATUS,
  });

  if (customerError) {
    await rollbackSignup(admin, rollbackState);
    return NextResponse.json(
      {
        error: isDuplicateClientIdError(customerError.message)
          ? "Unable to allocate customer ID. Please try again."
          : customerError.message,
      },
      { status: 400 },
    );
  }

  rollbackState.clientId = clientId;

  const { data: subscriptionRow, error: subscriptionError } = await admin
    .from("crm_subscriptions")
    .insert({
      tenant_id: DAVORS_TENANT_ID,
      customer_id: clientId,
      linked_tenant_id: tenantRow.id,
      product_id: null,
      trial_end_date: addTrialDays(new Date(), ERP_SUITE_TRIAL_DAYS),
      subscription_status: ERP_SUITE_SUBSCRIPTION_STATUS,
    })
    .select("id")
    .single();

  if (subscriptionError || !subscriptionRow) {
    await rollbackSignup(admin, rollbackState);
    return NextResponse.json(
      { error: subscriptionError?.message ?? "Failed to create subscription." },
      { status: 400 },
    );
  }

  rollbackState.subscriptionId = subscriptionRow.id;

  return NextResponse.json({
    message:
      "Account created. You can log in now — your 90-day trial starts once you log in.",
    tenant_id: tenantRow.id,
    slug,
    client_id: clientId,
  });
}
