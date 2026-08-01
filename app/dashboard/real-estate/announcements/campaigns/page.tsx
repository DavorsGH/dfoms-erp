import { Suspense } from "react";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
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
import type { LandlordListRow } from "../../landlords-utils";
import RealEstateShell from "../../real-estate-shell";
import AnnouncementsLandlordPicker from "../announcements-landlord-picker";
import AnnouncementsShell from "../announcements-shell";
import LesseeAnnouncementsCampaigns, {
  type AnnouncementLeaseOption,
  type AnnouncementLesseeOption,
  type AnnouncementPropertyOption,
} from "./lessee-announcements-campaigns";

type PageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

function filterAnnouncementLandlords(
  rows: LandlordListRow[],
): LandlordListRow[] {
  return rows.filter(
    (row) =>
      row.landlordType === "davors_managed" ||
      row.landlordType === "platform_only",
  );
}

export default async function LesseeAnnouncementCampaignsPage({
  searchParams,
}: PageProps) {
  const { landlord: landlordParam } = await searchParams;
  const requestedLandlordId = landlordParam?.trim() || null;

  const admin = createAdminClient();
  const { rows: allLandlords, fetchError: landlordsError } =
    await fetchLandlordListRows(admin);
  const landlords = filterAnnouncementLandlords(allLandlords);
  const selectedLandlordId =
    requestedLandlordId &&
    landlords.some((row) => row.tenantId === requestedLandlordId)
      ? requestedLandlordId
      : null;

  let announcements: ReturnType<typeof normalizeLesseeAnnouncementRow>[] = [];
  let activeTemplates: LesseeMessageTemplateRow[] = [];
  let properties: AnnouncementPropertyOption[] = [];
  let leases: AnnouncementLeaseOption[] = [];
  let lessees: AnnouncementLesseeOption[] = [];
  let fetchError: string | null = null;

  if (selectedLandlordId) {
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
        .eq("tenant_id", selectedLandlordId)
        .order("created_at", { ascending: false }),
      admin
        .from("lessee_message_templates")
        .select(LESSEE_MESSAGE_TEMPLATE_SELECT)
        .eq("tenant_id", selectedLandlordId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      admin
        .from("properties")
        .select("property_id, name")
        .eq("tenant_id", selectedLandlordId)
        .order("name", { ascending: true }),
      admin
        .from("leases")
        .select("lease_id, lessee_id, unit_id, status")
        .eq("tenant_id", selectedLandlordId)
        .eq("status", "active")
        .order("created_at", { ascending: false }),
      admin
        .from("property_units")
        .select("unit_id, unit_number, property_id")
        .eq("tenant_id", selectedLandlordId),
      admin
        .from("lessees")
        .select("lessee_id, full_name, email, phone, status")
        .eq("tenant_id", selectedLandlordId)
        .eq("status", "active")
        .order("full_name", { ascending: true }),
    ]);

    fetchError =
      announcementsResult.error?.message ??
      templatesResult.error?.message ??
      propertiesResult.error?.message ??
      leasesResult.error?.message ??
      unitsResult.error?.message ??
      lesseesResult.error?.message ??
      null;

    announcements = (
      (announcementsResult.data as unknown as LesseeAnnouncementRow[] | null) ??
      []
    ).map(normalizeLesseeAnnouncementRow);

    activeTemplates = (
      (templatesResult.data as LesseeMessageTemplateRow[] | null) ?? []
    ).map(normalizeLesseeMessageTemplateRow);

    properties = ((propertiesResult.data as AnnouncementPropertyOption[] | null) ??
      []).map((row) => ({
      property_id: row.property_id,
      name: row.name,
    }));

    const propertyNameById = new Map(
      properties.map((p) => [p.property_id, p.name]),
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
      ).map((u) => [
        u.unit_id,
        { unit_number: u.unit_number, property_id: u.property_id },
      ]),
    );
    const lesseeNameById = new Map(
      (
        (lesseesResult.data as
          | Array<{ lessee_id: string; full_name: string }>
          | null) ?? []
      ).map((l) => [l.lessee_id, l.full_name]),
    );

    leases = (
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

    lessees = (
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
  }

  return (
    <RealEstateShell sectionTitle="Portal Announcements">
      <Suspense fallback={null}>
        <AnnouncementsShell
          sectionTitle="Campaigns"
          landlordId={selectedLandlordId}
        >
          <AnnouncementsLandlordPicker
            landlords={landlords}
            selectedLandlordId={selectedLandlordId}
            basePath="/dashboard/real-estate/announcements/campaigns"
            landlordsError={landlordsError}
          />
          {selectedLandlordId ? (
            <LesseeAnnouncementsCampaigns
              tenantId={selectedLandlordId}
              initialAnnouncements={announcements}
              activeTemplates={activeTemplates}
              properties={properties}
              leases={leases}
              lessees={lessees}
              fetchError={fetchError}
            />
          ) : null}
        </AnnouncementsShell>
      </Suspense>
    </RealEstateShell>
  );
}
