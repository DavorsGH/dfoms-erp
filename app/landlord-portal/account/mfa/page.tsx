import Link from "next/link";
import { redirect } from "next/navigation";
import { getMfaSettingsForCurrentUser } from "@/lib/mfa/enrollment-actions";
import { getLandlordPortalSession } from "@/utils/landlord-portal-auth";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordMfaSettingsClient from "./mfa-settings-client";

export const dynamic = "force-dynamic";

export default async function LandlordPortalAccountMfaPage() {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }

  const settings = await getMfaSettingsForCurrentUser("landlord");

  return (
    <div className="space-y-6">
      <Link
        href="/landlord-portal/account"
        className="text-sm text-slate-500 underline hover:text-slate-800"
      >
        ← Back to My Account
      </Link>
      <h1 className={portalSectionTitleClassName}>Two-factor authentication</h1>
      <p className="mt-1 text-sm text-slate-600">
        Optional extra sign-in protection for the Landlord Portal.
      </p>
      <section className={portalSectionClassName}>
        <LandlordMfaSettingsClient initialSettings={settings} />
      </section>
    </div>
  );
}
