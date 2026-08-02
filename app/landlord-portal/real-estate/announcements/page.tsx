import { redirect } from "next/navigation";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  LESSEE_ANNOUNCEMENT_SELECT,
  normalizeLesseeAnnouncementRow,
  type LesseeAnnouncementRow,
} from "@/utils/lessee-announcements-types";
import {
  LESSEE_MESSAGE_TEMPLATE_SELECT,
  normalizeLesseeMessageTemplateRow,
  type LesseeMessageTemplateRow,
} from "@/utils/lessee-message-templates-types";
import LesseeAnnouncementsCampaigns, {
  type AnnouncementLeaseOption,
  type AnnouncementLesseeOption,
  type AnnouncementPropertyOption,
} from "@/app/dashboard/real-estate/announcements/campaigns/lessee-announcements-campaigns";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";

export default async function LandlordPortalAnnouncementsPage() {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }

  if (!landlordPortalHasDataAccess(session)) {
    return (
      <LandlordPortalPendingApprovalView
        fullName={session.fullName}
        approvalStatus={session.approvalStatus}
      />
    );
  }

  if (session.landlordType !== "platform_only") {
    return (
      <section className={portalSectionClassName}>
        <h1 className={portalSectionTitleClassName}>Announcements</h1>
        <p className="mt-3 text-sm text-slate-600">
          Tenant announcements are managed by Davors staff for managed
          landlords.
        </p>
      </section>
    );
  }

  const admin = createAdminClient();
  const tenantId = session.tenantId;

  const [
    announcementsResult,
    templatesResult,
    propertiesResult,
    leasesResult,
    unitsResult,
    lesseesResult,
  ] = await Promise.all([
    admin
      .from("lessee_announcements")
      .select(LESSEE_ANNOUNCEMENT_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    admin
      .from("lessee_message_templates")
      .select(LESSEE_MESSAGE_TEMPLATE_SELECT)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true }),
    admin
      .from("leases")
      .select("lease_id, lessee_id, unit_id, status")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    admin
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", tenantId),
    admin
      .from("lessees")
      .select("lessee_id, full_name, email, phone, status")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("full_name", { ascending: true }),
  ]);

  const fetchError =
    announcementsResult.error?.message ??
    templatesResult.error?.message ??
    propertiesResult.error?.message ??
    leasesResult.error?.message ??
    unitsResult.error?.message ??
    lesseesResult.error?.message ??
    null;

  const announcements = (
    (announcementsResult.data as unknown as LesseeAnnouncementRow[] | null) ??
    []
  ).map(normalizeLesseeAnnouncementRow);

  const activeTemplates = (
    (templatesResult.data as LesseeMessageTemplateRow[] | null) ?? []
  ).map(normalizeLesseeMessageTemplateRow);

  const properties: AnnouncementPropertyOption[] = (
    (propertiesResult.data as AnnouncementPropertyOption[] | null) ?? []
  ).map((row) => ({
    property_id: row.property_id,
    name: row.name,
  }));

  const propertyNameById = new Map(
    properties.map((property) => [property.property_id, property.name]),
  );
  const unitById = new Map(
    (
      (unitsResult.data as
        | Array<{
            unit_id: string;
            unit_number: string;
            property_id: string;
          }>
        | null) ?? []
    ).map((unit) => [
      unit.unit_id,
      { unit_number: unit.unit_number, property_id: unit.property_id },
    ]),
  );
  const lesseeNameById = new Map(
    (
      (lesseesResult.data as
        | Array<{ lessee_id: string; full_name: string }>
        | null) ?? []
    ).map((lessee) => [lessee.lessee_id, lessee.full_name]),
  );

  const leases: AnnouncementLeaseOption[] = (
    (leasesResult.data as
      | Array<{
          lease_id: string;
          lessee_id: string;
          unit_id: string | null;
          status: string;
        }>
      | null) ?? []
  ).map((lease) => {
    const unit = lease.unit_id ? unitById.get(lease.unit_id) : null;
    const propertyName = unit
      ? (propertyNameById.get(unit.property_id) ?? "Property")
      : "Property";
    const tenantName = lesseeNameById.get(lease.lessee_id) ?? "Tenant";
    const unitLabel = unit?.unit_number ? ` · Unit ${unit.unit_number}` : "";
    return {
      lease_id: lease.lease_id,
      lessee_id: lease.lessee_id,
      property_id: unit?.property_id ?? null,
      label: `${tenantName} — ${propertyName}${unitLabel}`,
    };
  });

  const lessees: AnnouncementLesseeOption[] = (
    (lesseesResult.data as
      | Array<{
          lessee_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
        }>
      | null) ?? []
  ).map((row) => ({
    lessee_id: row.lessee_id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className={portalSectionTitleClassName}>Announcements</h1>
        <p className="mt-1 text-sm text-slate-600">
          Compose and send announcements to your tenants (email, SMS, or
          in-app).
        </p>
      </div>

      <LesseeAnnouncementsCampaigns
        tenantId={tenantId}
        initialAnnouncements={announcements}
        activeTemplates={activeTemplates}
        properties={properties}
        leases={leases}
        lessees={lessees}
        fetchError={fetchError}
        apiBasePath="/api/landlord-portal/announcements"
      />
    </div>
  );
}
