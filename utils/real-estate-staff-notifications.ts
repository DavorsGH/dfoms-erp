import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import { sendResendEmail } from "@/utils/resend-email";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { createShortLinkUrl } from "@/utils/short-links";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import { insertLandlordPortalNotification } from "@/utils/landlord-portal-notifications";
import {
  formatRentMoney,
  formatRentPeriod,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";

type LeaseContext = {
  lesseeName: string;
  propertyName: string;
  unitNumber: string;
};

type NotificationRecipients = {
  landlordType: LandlordType | null;
  email: string | null;
  phone: string | null;
  /** Staff employee_notifications in-app (Davors super_admin). Landlord portal I is separate. */
  sendInApp: boolean;
};

type StaffNotifyPayload = {
  title: string;
  body: string;
  /** Relative dashboard path for in-app bell click-through (not shown in body). */
  actionUrl: string | null;
  emailSubject: string;
  emailHtml: string;
  emailText: string;
  smsContent: string;
  context: string;
  recipients: NotificationRecipients;
  /**
   * When set, also insert landlord portal in-app (if landlords.auth_user_id).
   * Used for both davors_managed (visibility) and platform_only.
   * Omit for staff-only events and for rent ops (receipt path owns landlord I).
   */
  landlordPortal?: {
    landlordTenantId: string;
    actionUrl: string | null;
  } | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Same base-URL convention as portal invite / signup emails. */
function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://portal.davorsfacilities.com"
  );
}

function staffDashboardUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${siteBaseUrl().replace(/\/$/, "")}${normalized}`;
}

/**
 * SMS-only: store absolute deep-link in short_links and return `{site}/s/{code}`.
 * Falls back to the full URL if insert fails so the SMS still delivers a usable link.
 */
async function smsDeepLinkUrl(absoluteDeepLink: string): Promise<string> {
  try {
    return await createShortLinkUrl(absoluteDeepLink);
  } catch (error) {
    console.error(
      "[real-estate-staff-notifications] short-link create failed; using full URL:",
      error instanceof Error ? error.message : error,
    );
    return absoluteDeepLink;
  }
}

function landlordFilteredPath(
  section: "complaints" | "maintenance" | "rent-ledger",
  landlordTenantId: string,
): string {
  return `/dashboard/real-estate/${section}?landlord=${encodeURIComponent(landlordTenantId)}`;
}

/** Landlord portal click-through targets (relative). */
function landlordPortalPath(
  section:
    | "complaints"
    | "maintenance"
    | "terminations"
    | "rent-ledger"
    | "applications",
  applicationId?: string,
): string {
  if (section === "rent-ledger") {
    return "/landlord-portal/finance/rent-ledger";
  }
  if (section === "applications") {
    const id = applicationId?.trim();
    return id
      ? `/landlord-portal/real-estate/applications/${encodeURIComponent(id)}`
      : "/landlord-portal/real-estate/applications";
  }
  return `/landlord-portal/${section}`;
}

function leaseDetailPath(landlordTenantId: string, leaseId: string): string {
  return `/dashboard/real-estate/leases/${encodeURIComponent(landlordTenantId)}/${encodeURIComponent(leaseId)}`;
}

/**
 * Landlords section list (Real Estate nav "tab"), with optional row highlight.
 * Prefer this over `/landlords/[tenantId]` for pending-approval bells so a
 * missing/deleted tenant cannot hard-404 the click-through; staff open detail
 * from the highlighted row to approve/reject.
 */
function landlordPendingApprovalPath(landlordTenantId: string): string {
  return `/dashboard/real-estate/landlords?highlight=${encodeURIComponent(landlordTenantId)}`;
}

async function loadDavorsStaffAuthUids(): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_accounts")
    .select("auth_uid, role, is_active")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("is_active", true)
    .eq("role", "super_admin");

  if (error) {
    throw new Error(error.message);
  }

  const uids: string[] = [];
  for (const row of data ?? []) {
    const authUid =
      typeof row.auth_uid === "string" ? row.auth_uid.trim() : "";
    if (authUid) {
      uids.push(authUid);
    }
  }
  return uids;
}

async function loadDavorsWorkspaceContacts(): Promise<{
  email: string | null;
  phone: string | null;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("email, phone")
    .eq("id", DAVORS_TENANT_ID)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const email =
    typeof data?.email === "string" ? data.email.trim() || null : null;
  const phone =
    typeof data?.phone === "string" ? data.phone.trim() || null : null;
  return { email, phone };
}

/**
 * Resolve SMS/email/in-app recipients from DB settings (not env).
 * - forceDavors (event 5): always Davors workspace contacts + in-app
 * - davors_managed: Davors workspace phone/email + in-app
 * - platform_only: landlords.notification_phone + tenants.email; no in-app
 */
async function resolveNotificationRecipients(options: {
  landlordTenantId: string;
  forceDavors?: boolean;
}): Promise<NotificationRecipients> {
  if (options.forceDavors) {
    const contacts = await loadDavorsWorkspaceContacts();
    return {
      landlordType: null,
      email: contacts.email,
      phone: contacts.phone,
      sendInApp: true,
    };
  }

  const admin = createAdminClient();
  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("landlord_type, notification_phone")
    .eq("tenant_id", options.landlordTenantId)
    .maybeSingle();

  if (landlordError) {
    throw new Error(landlordError.message);
  }

  const landlordType = landlord?.landlord_type as LandlordType | null;

  if (landlordType === "platform_only") {
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("email")
      .eq("id", options.landlordTenantId)
      .maybeSingle();

    if (tenantError) {
      throw new Error(tenantError.message);
    }

    const email =
      typeof tenant?.email === "string" ? tenant.email.trim() || null : null;
    const phone =
      typeof landlord?.notification_phone === "string"
        ? landlord.notification_phone.trim() || null
        : null;

    return {
      landlordType,
      email,
      phone,
      sendInApp: false,
    };
  }

  // davors_managed (or unknown/missing type): Davors staff contacts
  const contacts = await loadDavorsWorkspaceContacts();
  return {
    landlordType: landlordType ?? "davors_managed",
    email: contacts.email,
    phone: contacts.phone,
    sendInApp: true,
  };
}

async function loadLeaseContext(
  landlordTenantId: string,
  leaseId: string,
): Promise<LeaseContext> {
  const admin = createAdminClient();
  const fallback: LeaseContext = {
    lesseeName: "Tenant",
    propertyName: "—",
    unitNumber: "—",
  };

  try {
    const { data: lease } = await admin
      .from("leases")
      .select("lessee_id, unit_id")
      .eq("tenant_id", landlordTenantId)
      .eq("lease_id", leaseId)
      .maybeSingle();

    if (!lease) {
      return fallback;
    }

    const [{ data: lessee }, { data: unit }] = await Promise.all([
      lease.lessee_id
        ? admin
            .from("lessees")
            .select("full_name")
            .eq("tenant_id", landlordTenantId)
            .eq("lessee_id", lease.lessee_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      lease.unit_id
        ? admin
            .from("property_units")
            .select("unit_number, property_id")
            .eq("tenant_id", landlordTenantId)
            .eq("unit_id", lease.unit_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    let propertyName = "—";
    if (unit?.property_id) {
      const { data: property } = await admin
        .from("properties")
        .select("name")
        .eq("tenant_id", landlordTenantId)
        .eq("property_id", unit.property_id)
        .maybeSingle();
      propertyName = property?.name?.trim() || "—";
    }

    return {
      lesseeName: lessee?.full_name?.trim() || "Tenant",
      propertyName,
      unitNumber: unit?.unit_number?.trim() || "—",
    };
  } catch {
    return fallback;
  }
}

async function insertInAppNotifications(
  title: string,
  body: string,
  actionUrl: string | null,
  context: string,
): Promise<void> {
  try {
    const recipientIds = await loadDavorsStaffAuthUids();
    if (recipientIds.length === 0) {
      console.warn(
        `[real-estate-staff-notifications] Skipping in-app ${context}: no active Davors super_admin recipients.`,
      );
      return;
    }

    const admin = createAdminClient();
    const rows = recipientIds.map((recipient_user_id) => ({
      tenant_id: DAVORS_TENANT_ID,
      recipient_user_id,
      announcement_id: null,
      title,
      body,
      action_url: actionUrl,
    }));

    let { error } = await admin.from("employee_notifications").insert(rows);
    // Pre-migration fallback: column missing — embed destination in body (legacy).
    if (
      error &&
      actionUrl &&
      /action_url/i.test(error.message) &&
      /does not exist|could not find|schema cache|column/i.test(error.message)
    ) {
      const legacyRows = recipientIds.map((recipient_user_id) => ({
        tenant_id: DAVORS_TENANT_ID,
        recipient_user_id,
        announcement_id: null,
        title,
        body: `${body}\n${staffDashboardUrl(actionUrl)}`,
      }));
      ({ error } = await admin.from("employee_notifications").insert(legacyRows));
    }
    if (error) {
      console.error(
        `[real-estate-staff-notifications] in-app insert failed (${context}):`,
        error.message,
      );
    }
  } catch (error) {
    console.error(
      `[real-estate-staff-notifications] in-app failed (${context}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

async function sendStaffEmail(options: {
  to: string | null;
  subject: string;
  html: string;
  text: string;
  context: string;
}): Promise<void> {
  try {
    const to = options.to?.trim() || null;
    if (!to) {
      console.warn(
        `[real-estate-staff-notifications] Skipping email ${options.context}: no notification email configured.`,
      );
      return;
    }

    const result = await sendResendEmail({
      to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (!result.ok) {
      console.error(
        `[real-estate-staff-notifications] email failed (${options.context}):`,
        result.error,
      );
    }
  } catch (error) {
    console.error(
      `[real-estate-staff-notifications] email failed (${options.context}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

async function sendStaffSms(options: {
  phone: string | null;
  content: string;
  context: string;
}): Promise<void> {
  try {
    const raw = options.phone?.trim() || null;
    if (!raw) {
      console.warn(
        `[real-estate-staff-notifications] Skipping SMS ${options.context}: no notification phone configured.`,
      );
      return;
    }

    const to = normalizeGhanaPhone(raw) ?? raw;
    const result = await sendHubtelSms({ to, content: options.content });
    if (!result.ok) {
      console.error(
        `[real-estate-staff-notifications] SMS failed (${options.context}):`,
        result.error,
      );
    }
  } catch (error) {
    console.error(
      `[real-estate-staff-notifications] SMS failed (${options.context}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

async function dispatchStaffNotification(
  payload: StaffNotifyPayload,
): Promise<void> {
  const tasks: Array<Promise<void>> = [
    sendStaffEmail({
      to: payload.recipients.email,
      subject: payload.emailSubject,
      html: payload.emailHtml,
      text: payload.emailText,
      context: payload.context,
    }),
    sendStaffSms({
      phone: payload.recipients.phone,
      content: payload.smsContent,
      context: payload.context,
    }),
  ];

  if (payload.recipients.sendInApp) {
    tasks.push(
      insertInAppNotifications(
        payload.title,
        payload.body,
        payload.actionUrl,
        payload.context,
      ),
    );
  }

  if (payload.landlordPortal) {
    tasks.push(
      insertLandlordPortalNotification({
        landlordTenantId: payload.landlordPortal.landlordTenantId,
        title: payload.title,
        body: payload.body,
        actionUrl: payload.landlordPortal.actionUrl,
        context: payload.context,
      }).then(() => undefined),
    );
  }

  await Promise.all(tasks);
}

function buildEmailShell(
  heading: string,
  lines: Array<[string, string]>,
  deepLink: string,
): {
  html: string;
  text: string;
} {
  const text = [
    heading,
    "",
    ...lines.map(([label, value]) => `${label}: ${value}`),
    "",
    `Open: ${deepLink}`,
  ].join("\n");

  const html = `
    <h2>${escapeHtml(heading)}</h2>
    <ul>
      ${lines
        .map(
          ([label, value]) =>
            `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`,
        )
        .join("\n      ")}
    </ul>
    <p><a href="${escapeHtml(deepLink)}">Open in dashboard</a></p>
  `.trim();

  return { html, text };
}

function formatLandlordTypeLabel(landlordType: string): string {
  if (landlordType === "davors_managed") {
    return "Davors managed";
  }
  if (landlordType === "platform_only") {
    return "Platform only";
  }
  return landlordType;
}

/** EVENT 1 — portal repair / maintenance request submitted. */
export async function notifyStaffNewRepairRequest(options: {
  landlordTenantId: string;
  leaseId: string;
  requestId: string;
  description: string;
  tenantSelfFix: boolean;
  proposedCostGhs: number | null;
}): Promise<void> {
  try {
    const [ctx, recipients] = await Promise.all([
      loadLeaseContext(options.landlordTenantId, options.leaseId),
      resolveNotificationRecipients({
        landlordTenantId: options.landlordTenantId,
      }),
    ]);
    const descPreview =
      options.description.length > 120
        ? `${options.description.slice(0, 117)}…`
        : options.description;
    const selfFixLabel = options.tenantSelfFix
      ? options.proposedCostGhs != null
        ? `Yes (proposed ${formatRentMoney(options.proposedCostGhs)})`
        : "Yes"
      : "No";
    const actionPath = landlordFilteredPath(
      "maintenance",
      options.landlordTenantId,
    );
    const deepLink = staffDashboardUrl(actionPath);
    const smsLink = await smsDeepLinkUrl(deepLink);

    const title = "New repair request";
    const body = [
      `${ctx.lesseeName} submitted a repair request.`,
      `Property: ${ctx.propertyName} / Unit ${ctx.unitNumber}`,
      `Self-fix: ${selfFixLabel}`,
      descPreview,
    ].join("\n");

    const { html, text } = buildEmailShell(
      title,
      [
        ["Tenant", ctx.lesseeName],
        ["Property", ctx.propertyName],
        ["Unit", ctx.unitNumber],
        ["Self-fix", selfFixLabel],
        ["Description", descPreview],
      ],
      deepLink,
    );

    await dispatchStaffNotification({
      title,
      body,
      actionUrl: actionPath,
      emailSubject: `Real Estate: New repair request — ${ctx.lesseeName}`,
      emailHtml: html,
      emailText: text,
      smsContent: `Davors RE: Repair from ${ctx.lesseeName}, ${ctx.propertyName} unit ${ctx.unitNumber}. ${smsLink}`,
      context: `repair:${options.requestId}`,
      recipients,
      landlordPortal: {
        landlordTenantId: options.landlordTenantId,
        actionUrl: landlordPortalPath("maintenance"),
      },
    });
  } catch (error) {
    console.error(
      "[real-estate-staff-notifications] notifyStaffNewRepairRequest failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** EVENT 2 — portal complaint submitted. */
export async function notifyStaffNewComplaint(options: {
  landlordTenantId: string;
  leaseId: string;
  complaintId: string;
  subject: string;
  description: string;
  lesseeName?: string | null;
}): Promise<void> {
  try {
    const [ctx, recipients] = await Promise.all([
      loadLeaseContext(options.landlordTenantId, options.leaseId),
      resolveNotificationRecipients({
        landlordTenantId: options.landlordTenantId,
      }),
    ]);
    const lesseeName = options.lesseeName?.trim() || ctx.lesseeName;
    const actionPath = landlordFilteredPath(
      "complaints",
      options.landlordTenantId,
    );
    const deepLink = staffDashboardUrl(actionPath);
    const smsLink = await smsDeepLinkUrl(deepLink);

    const title = "New tenant complaint";
    const body = [
      `${lesseeName} submitted a complaint.`,
      `Subject: ${options.subject}`,
      `Property: ${ctx.propertyName} / Unit ${ctx.unitNumber}`,
    ].join("\n");

    const { html, text } = buildEmailShell(
      title,
      [
        ["Tenant", lesseeName],
        ["Subject", options.subject],
        ["Property", ctx.propertyName],
        ["Unit", ctx.unitNumber],
      ],
      deepLink,
    );

    await dispatchStaffNotification({
      title,
      body,
      actionUrl: actionPath,
      emailSubject: `Real Estate: New complaint — ${options.subject}`,
      emailHtml: html,
      emailText: text,
      smsContent: `Davors RE: Complaint from ${lesseeName}: ${options.subject}. ${ctx.propertyName} unit ${ctx.unitNumber}. ${smsLink}`,
      context: `complaint:${options.complaintId}`,
      recipients,
      landlordPortal: {
        landlordTenantId: options.landlordTenantId,
        actionUrl: landlordPortalPath("complaints"),
      },
    });
  } catch (error) {
    console.error(
      "[real-estate-staff-notifications] notifyStaffNewComplaint failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** EVENT 3 — portal rent Paystack payment successfully fulfilled (not duplicates). */
export async function notifyStaffRentPaymentReceived(options: {
  landlordTenantId: string;
  leaseId: string;
  entryId: string;
  amountGhs: number;
  periodStart: string;
  periodEnd: string;
  paymentMethod: string;
  reference: string;
  lesseeName?: string | null;
}): Promise<void> {
  try {
    const [ctx, recipients] = await Promise.all([
      loadLeaseContext(options.landlordTenantId, options.leaseId),
      resolveNotificationRecipients({
        landlordTenantId: options.landlordTenantId,
      }),
    ]);
    const lesseeName = options.lesseeName?.trim() || ctx.lesseeName;
    const amountLabel = formatRentMoney(options.amountGhs);
    const periodLabel = formatRentPeriod(
      options.periodStart,
      options.periodEnd,
    );
    const actionPath = landlordFilteredPath(
      "rent-ledger",
      options.landlordTenantId,
    );
    const deepLink = staffDashboardUrl(actionPath);
    const smsLink = await smsDeepLinkUrl(deepLink);

    const title = "Rent payment received";
    const body = [
      `${lesseeName} paid ${amountLabel}.`,
      `Period: ${periodLabel}`,
      `Property: ${ctx.propertyName} / Unit ${ctx.unitNumber}`,
      `Method: ${options.paymentMethod}`,
    ].join("\n");

    const { html, text } = buildEmailShell(
      title,
      [
        ["Tenant", lesseeName],
        ["Amount", amountLabel],
        ["Period", periodLabel],
        ["Property", ctx.propertyName],
        ["Unit", ctx.unitNumber],
        ["Method", options.paymentMethod],
      ],
      deepLink,
    );

    // Staff E/S/I only — landlord in-app is owned by notifyRentPaystackSuccess
    // (receipt path) to avoid duplicate landlord portal rows per payment.
    await dispatchStaffNotification({
      title,
      body,
      actionUrl: actionPath,
      emailSubject: `Real Estate: Rent received — ${lesseeName} (${amountLabel})`,
      emailHtml: html,
      emailText: text,
      smsContent: `Davors RE: Rent ${amountLabel} from ${lesseeName} (${periodLabel}). ${smsLink}`,
      context: `rent-paystack:${options.reference}`,
      recipients,
      landlordPortal: null,
    });
  } catch (error) {
    console.error(
      "[real-estate-staff-notifications] notifyStaffRentPaymentReceived failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** EVENT 4 — early termination request pending staff approval. */
export async function notifyStaffEarlyTerminationRequest(options: {
  landlordTenantId: string;
  leaseId: string;
  reason: string | null;
  lesseeName?: string | null;
}): Promise<void> {
  try {
    const [ctx, recipients] = await Promise.all([
      loadLeaseContext(options.landlordTenantId, options.leaseId),
      resolveNotificationRecipients({
        landlordTenantId: options.landlordTenantId,
      }),
    ]);
    const lesseeName = options.lesseeName?.trim() || ctx.lesseeName;
    const reasonLabel = options.reason?.trim() || "(no reason provided)";
    const actionPath = leaseDetailPath(
      options.landlordTenantId,
      options.leaseId,
    );
    const deepLink = staffDashboardUrl(actionPath);
    const smsLink = await smsDeepLinkUrl(deepLink);

    const title = "Early termination request";
    const body = [
      `${lesseeName} requested early lease termination.`,
      `Property: ${ctx.propertyName} / Unit ${ctx.unitNumber}`,
      `Reason: ${reasonLabel}`,
    ].join("\n");

    const { html, text } = buildEmailShell(
      title,
      [
        ["Tenant", lesseeName],
        ["Property", ctx.propertyName],
        ["Unit", ctx.unitNumber],
        ["Reason", reasonLabel],
      ],
      deepLink,
    );

    await dispatchStaffNotification({
      title,
      body,
      actionUrl: actionPath,
      emailSubject: `Real Estate: Early termination request — ${lesseeName}`,
      emailHtml: html,
      emailText: text,
      smsContent: `Davors RE: Early termination from ${lesseeName}, ${ctx.propertyName} unit ${ctx.unitNumber}. ${smsLink}`,
      context: `termination:${options.leaseId}`,
      recipients,
      landlordPortal: {
        landlordTenantId: options.landlordTenantId,
        actionUrl: landlordPortalPath("terminations"),
      },
    });
  } catch (error) {
    console.error(
      "[real-estate-staff-notifications] notifyStaffEarlyTerminationRequest failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** EVENT 5 — landlord row inserted with approval_status pending. Always Davors. */
export async function notifyStaffLandlordPendingApproval(options: {
  landlordTenantId: string;
  landlordType: string;
  landlordName?: string | null;
}): Promise<void> {
  try {
    let landlordName = options.landlordName?.trim() || "";
    if (!landlordName) {
      const admin = createAdminClient();
      const { data: tenant } = await admin
        .from("tenants")
        .select("name")
        .eq("id", options.landlordTenantId)
        .maybeSingle();
      landlordName = tenant?.name?.trim() || "Landlord";
    }

    const recipients = await resolveNotificationRecipients({
      landlordTenantId: options.landlordTenantId,
      forceDavors: true,
    });
    const typeLabel = formatLandlordTypeLabel(options.landlordType);
    const actionPath = landlordPendingApprovalPath(options.landlordTenantId);
    const deepLink = staffDashboardUrl(actionPath);
    const smsLink = await smsDeepLinkUrl(deepLink);

    const title = "Landlord pending approval";
    const body = [
      `${landlordName} was added and is pending approval.`,
      `Type: ${typeLabel}`,
    ].join("\n");

    const { html, text } = buildEmailShell(
      title,
      [
        ["Landlord", landlordName],
        ["Type", typeLabel],
        ["Status", "Pending approval"],
      ],
      deepLink,
    );

    await dispatchStaffNotification({
      title,
      body,
      actionUrl: actionPath,
      emailSubject: `Real Estate: Landlord pending approval — ${landlordName}`,
      emailHtml: html,
      emailText: text,
      smsContent: `Davors RE: Landlord "${landlordName}" pending approval (${typeLabel}). ${smsLink}`,
      context: `landlord-pending:${options.landlordTenantId}`,
      recipients,
    });
  } catch (error) {
    console.error(
      "[real-estate-staff-notifications] notifyStaffLandlordPendingApproval failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** EVENT 6 — public rental application submitted. Notify landlord contacts; staff for davors_managed. */
export async function notifyLandlordNewRentalApplication(options: {
  landlordTenantId: string;
  applicationId: string;
  applicantName: string;
  propertyName: string;
  unitNumber: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: landlord }, { data: tenant }] = await Promise.all([
      admin
        .from("landlords")
        .select("landlord_type, notification_phone")
        .eq("tenant_id", options.landlordTenantId)
        .maybeSingle(),
      admin
        .from("tenants")
        .select("email")
        .eq("id", options.landlordTenantId)
        .maybeSingle(),
    ]);

    const landlordType = landlord?.landlord_type as LandlordType | null;
    const landlordActionPath = `/landlord-portal/real-estate/applications/${encodeURIComponent(options.applicationId)}`;
    const staffActionPath = `/dashboard/real-estate/applications?landlord=${encodeURIComponent(options.landlordTenantId)}`;
    const landlordDeepLink = `${siteBaseUrl().replace(/\/$/, "")}${landlordActionPath}`;
    const staffDeepLink = staffDashboardUrl(staffActionPath);
    const deepLink =
      landlordType === "davors_managed" ? staffDeepLink : landlordDeepLink;
    const smsLink = await smsDeepLinkUrl(deepLink);

    const title = "New rental application";
    const body = `${options.applicantName} applied for ${options.propertyName} / Unit ${options.unitNumber}.`;

    const { html, text } = buildEmailShell(
      title,
      [
        ["Applicant", options.applicantName],
        ["Property", options.propertyName],
        ["Unit", options.unitNumber],
      ],
      deepLink,
    );

    // Always notify the landlord workspace contacts (both landlord types review apps).
    const landlordEmail =
      typeof tenant?.email === "string" ? tenant.email.trim() || null : null;
    const landlordPhone =
      typeof landlord?.notification_phone === "string"
        ? landlord.notification_phone.trim() || null
        : null;

    await dispatchStaffNotification({
      title,
      body,
      actionUrl: null,
      emailSubject: `Real Estate: New rental application — ${options.applicantName}`,
      emailHtml: html,
      emailText: text,
      smsContent: `Davors RE: Application from ${options.applicantName}, ${options.propertyName} unit ${options.unitNumber}. ${smsLink}`,
      context: `rental-app:${options.applicationId}`,
      recipients: {
        landlordType,
        email: landlordEmail,
        phone: landlordPhone,
        sendInApp: false,
      },
      landlordPortal: {
        landlordTenantId: options.landlordTenantId,
        actionUrl: landlordPortalPath(
          "applications",
          options.applicationId,
        ),
      },
    });

    // Oversight: davors_managed also notifies Davors staff.
    if (landlordType === "davors_managed") {
      const staffRecipients = await resolveNotificationRecipients({
        landlordTenantId: options.landlordTenantId,
        forceDavors: true,
      });
      const staffSmsLink = await smsDeepLinkUrl(staffDeepLink);
      const staffShell = buildEmailShell(
        title,
        [
          ["Applicant", options.applicantName],
          ["Property", options.propertyName],
          ["Unit", options.unitNumber],
        ],
        staffDeepLink,
      );
      await dispatchStaffNotification({
        title,
        body,
        actionUrl: staffActionPath,
        emailSubject: `Real Estate: New rental application — ${options.applicantName}`,
        emailHtml: staffShell.html,
        emailText: staffShell.text,
        smsContent: `Davors RE: Application from ${options.applicantName}, ${options.propertyName} unit ${options.unitNumber}. ${staffSmsLink}`,
        context: `rental-app-staff:${options.applicationId}`,
        recipients: staffRecipients,
      });
    }
  } catch (error) {
    console.error(
      "[real-estate-staff-notifications] notifyLandlordNewRentalApplication failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
