import { Suspense } from "react";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import {
  LESSEE_MESSAGE_TEMPLATE_SELECT,
  normalizeLesseeMessageTemplateRow,
  type LesseeMessageTemplateRow,
} from "@/utils/lessee-message-templates-types";
import type { LandlordListRow } from "../../landlords-utils";
import RealEstateShell from "../../real-estate-shell";
import AnnouncementsLandlordPicker from "../announcements-landlord-picker";
import AnnouncementsShell from "../announcements-shell";
import LesseeMessageTemplates from "./lessee-message-templates";

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

export default async function LesseeAnnouncementTemplatesPage({
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

  let templates: LesseeMessageTemplateRow[] = [];
  let templatesError: string | null = null;

  if (selectedLandlordId) {
    const { data, error } = await admin
      .from("lessee_message_templates")
      .select(LESSEE_MESSAGE_TEMPLATE_SELECT)
      .eq("tenant_id", selectedLandlordId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false });

    if (error) {
      templatesError = error.message;
    } else {
      templates = ((data as LesseeMessageTemplateRow[] | null) ?? []).map(
        normalizeLesseeMessageTemplateRow,
      );
    }
  }

  return (
    <RealEstateShell sectionTitle="Portal Announcements">
      <Suspense fallback={null}>
        <AnnouncementsShell
          sectionTitle="Templates"
          landlordId={selectedLandlordId}
        >
          <AnnouncementsLandlordPicker
            landlords={landlords}
            selectedLandlordId={selectedLandlordId}
            basePath="/dashboard/real-estate/announcements/templates"
            landlordsError={landlordsError}
          />
          {selectedLandlordId ? (
            <LesseeMessageTemplates
              tenantId={selectedLandlordId}
              initialTemplates={templates}
              fetchError={templatesError}
            />
          ) : null}
        </AnnouncementsShell>
      </Suspense>
    </RealEstateShell>
  );
}
