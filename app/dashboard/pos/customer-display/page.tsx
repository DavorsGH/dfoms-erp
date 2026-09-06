import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { loadBusinessUnitDocumentContact } from "@/utils/business-unit-document-contact";
import { resolveSwitcherLetterheadBusinessUnitId } from "@/utils/business-unit-document-contact-types";
import { getCurrentTenantBranding } from "@/utils/tenant-branding";
import { buildPosCustomerDisplayChannelName } from "@/lib/pos-customer-display-channel";
import PosCustomerDisplayView from "./pos-customer-display-view";

type CustomerDisplayPageProps = {
  searchParams: Promise<{ session?: string | string[] }>;
};

export default async function PosCustomerDisplayPage({
  searchParams,
}: CustomerDisplayPageProps) {
  const params = await searchParams;
  const sessionParam = params.session;
  const sessionId =
    typeof sessionParam === "string"
      ? sessionParam.trim()
      : Array.isArray(sessionParam)
        ? sessionParam[0]?.trim() ?? ""
        : "";

  if (!sessionId) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Missing display session. Open Customer Display from the POS checkout screen.
      </p>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits, tenantBranding] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
      getCurrentTenantBranding(),
    ]);

  if (!tenantId) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Unable to resolve workspace for customer display.
      </p>
    );
  }

  const letterheadBusinessUnitId = resolveSwitcherLetterheadBusinessUnitId({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const businessUnitContact = await loadBusinessUnitDocumentContact(
    supabase,
    tenantId,
    letterheadBusinessUnitId,
  );

  const displayName =
    businessUnitContact?.name?.trim() ||
    tenantBranding.workspaceName?.trim() ||
    "Welcome";
  const logoUrl =
    businessUnitContact?.logoUrl?.trim() ||
    tenantBranding.workspaceLogoUrl?.trim() ||
    null;

  const channelName = buildPosCustomerDisplayChannelName(
    tenantId,
    letterheadBusinessUnitId,
    sessionId,
  );

  return (
    <PosCustomerDisplayView
      channelName={channelName}
      branding={{ displayName, logoUrl }}
    />
  );
}
