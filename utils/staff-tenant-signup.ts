import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyNewTenantSignup } from "@/utils/admin-notifications";
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
  isDuplicateSlugError,
  slugifyCompanyName,
} from "@/utils/tenant-signup";
import { provisionSignupOwnerEmployeeAndApprovers } from "@/utils/tenant-signup-owner-provisioning";
import { seedTenantPaymentMethodsFromDavorsTemplate } from "@/utils/tenant-payment-methods-seed";
import {
  rollbackTenantClientDocumentNotifications,
  seedTenantClientDocumentNotifications,
} from "@/utils/tenant-client-document-notifications-seed";
import { syncAuthUserPortalMetadata } from "@/lib/auth/portal-metadata";

type AdminClient = SupabaseClient;

export type StaffTenantSignupInput = {
  authUserId: string;
  companyName: string;
  adminFullName: string;
  adminEmail: string;
};

type SignupRollbackState = {
  authUserId: string | null;
  tenantId: string | null;
  clientId: string | null;
  subscriptionId: string | null;
  deleteAuthUser: boolean;
};

export type StaffTenantSignupResult =
  | { ok: true; tenantId: string; slug: string; clientId: string }
  | { ok: false; error: string; status: number };

async function rollbackStaffTenantSignup(
  admin: AdminClient,
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
    if (state.deleteAuthUser) {
      await admin.auth.admin.deleteUser(state.authUserId);
    }
  }

  if (state.tenantId) {
    await rollbackTenantClientDocumentNotifications(admin, state.tenantId);
    await admin
      .from("leave_approver_config")
      .delete()
      .eq("tenant_id", state.tenantId);
    await admin.from("approvers").delete().eq("tenant_id", state.tenantId);
    await admin.from("employees").delete().eq("tenant_id", state.tenantId);
    await admin
      .from("positions")
      .delete()
      .eq("tenant_id", state.tenantId)
      .eq("position_title", "Administrator");
    await admin.from("payment_methods").delete().eq("tenant_id", state.tenantId);
    await admin
      .from("inventory_balance_config")
      .delete()
      .eq("tenant_id", state.tenantId);
    await admin.from("tenants").delete().eq("id", state.tenantId);
  }
}

async function resolveAvailableSlug(
  admin: AdminClient,
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

/**
 * Full staff ERP tenant provisioning for password or OAuth open signup.
 * Caller must create (or reuse) the Supabase Auth user before calling.
 */
export async function provisionStaffTenantSignup(
  admin: AdminClient,
  input: StaffTenantSignupInput,
  options?: { deleteAuthUserOnRollback?: boolean },
): Promise<StaffTenantSignupResult> {
  const { authUserId, companyName, adminFullName, adminEmail } = input;
  const signupDate = new Date().toISOString().slice(0, 10);
  const rollbackState: SignupRollbackState = {
    authUserId,
    tenantId: null,
    clientId: null,
    subscriptionId: null,
    deleteAuthUser: options?.deleteAuthUserOnRollback ?? false,
  };

  const slug = await resolveAvailableSlug(admin, companyName);
  if (!slug) {
    return {
      ok: false,
      error: "Unable to verify company availability. Please try again.",
      status: 503,
    };
  }

  const { data: existingCustomers, error: customersLookupError } = await admin
    .from("customers")
    .select("client_id")
    .eq("tenant_id", DAVORS_TENANT_ID);

  if (customersLookupError) {
    return { ok: false, error: customersLookupError.message, status: 503 };
  }

  const clientId = generateNextCustomerClientId(
    (existingCustomers ?? []).map((row) => row.client_id),
  );

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
    await rollbackStaffTenantSignup(admin, rollbackState);
    return {
      ok: false,
      error: isDuplicateSlugError(tenantError?.message ?? "")
        ? "This company name is already registered. Try a different name."
        : (tenantError?.message ?? "Failed to create tenant."),
      status: 400,
    };
  }

  rollbackState.tenantId = tenantRow.id;

  const { error: userAccountError } = await admin.from("user_accounts").insert({
    auth_uid: authUserId,
    tenant_id: tenantRow.id,
    role: "super_admin",
    employee_id: null,
    client_id: null,
    email: adminEmail,
    is_active: true,
  });

  if (userAccountError) {
    await rollbackStaffTenantSignup(admin, rollbackState);
    return { ok: false, error: userAccountError.message, status: 400 };
  }

  const { error: inventoryConfigError } = await admin
    .from("inventory_balance_config")
    .insert({
      tenant_id: tenantRow.id,
      go_live_date: signupDate,
      opening_inventory_value: 0,
    });

  if (inventoryConfigError) {
    await rollbackStaffTenantSignup(admin, rollbackState);
    return { ok: false, error: inventoryConfigError.message, status: 400 };
  }

  const paymentMethodsSeed = await seedTenantPaymentMethodsFromDavorsTemplate(
    admin,
    tenantRow.id,
  );
  if (paymentMethodsSeed.error) {
    await rollbackStaffTenantSignup(admin, rollbackState);
    return { ok: false, error: paymentMethodsSeed.error, status: 400 };
  }

  const ownerProvisioning = await provisionSignupOwnerEmployeeAndApprovers(
    admin,
    {
      tenantId: tenantRow.id,
      authUid: authUserId,
      adminFullName,
      adminEmail,
      signupDate,
    },
  );
  if (ownerProvisioning.error) {
    await rollbackStaffTenantSignup(admin, rollbackState);
    return { ok: false, error: ownerProvisioning.error, status: 400 };
  }

  const clientDocNotificationsSeed = await seedTenantClientDocumentNotifications(
    admin,
    tenantRow.id,
  );
  if (clientDocNotificationsSeed.error) {
    await rollbackStaffTenantSignup(admin, rollbackState);
    return { ok: false, error: clientDocNotificationsSeed.error, status: 400 };
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
    await rollbackStaffTenantSignup(admin, rollbackState);
    return {
      ok: false,
      error: isDuplicateClientIdError(customerError.message)
        ? "Unable to allocate customer ID. Please try again."
        : customerError.message,
      status: 400,
    };
  }

  rollbackState.clientId = clientId;

  const trialEndDate = addTrialDays(new Date(), ERP_SUITE_TRIAL_DAYS);

  const { data: subscriptionRow, error: subscriptionError } = await admin
    .from("crm_subscriptions")
    .insert({
      tenant_id: DAVORS_TENANT_ID,
      customer_id: clientId,
      linked_tenant_id: tenantRow.id,
      product_id: null,
      trial_end_date: trialEndDate,
      subscription_status: ERP_SUITE_SUBSCRIPTION_STATUS,
    })
    .select("id")
    .single();

  if (subscriptionError || !subscriptionRow) {
    await rollbackStaffTenantSignup(admin, rollbackState);
    return {
      ok: false,
      error: subscriptionError?.message ?? "Failed to create subscription.",
      status: 400,
    };
  }

  rollbackState.subscriptionId = subscriptionRow.id;

  await syncAuthUserPortalMetadata(authUserId, "staff");

  void notifyNewTenantSignup({
    tenantName: companyName,
    adminEmail,
    trialEndDate,
  });

  return { ok: true, tenantId: tenantRow.id, slug, clientId };
}
