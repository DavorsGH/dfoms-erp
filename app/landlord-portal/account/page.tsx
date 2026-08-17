import Link from "next/link";
import { redirect } from "next/navigation";
import PushNotificationsSettings from "@/components/push-notifications-settings";
import { getLandlordPortalSession } from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  portalPrimaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalAccountChangePasswordForm from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function LandlordPortalAccountPage() {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }

  const admin = createAdminClient();
  const [{ data: landlord }, { data: tenant }] = await Promise.all([
    admin
      .from("landlords")
      .select("notification_phone")
      .eq("tenant_id", session.tenantId)
      .maybeSingle(),
    admin
      .from("tenants")
      .select("phone")
      .eq("id", session.tenantId)
      .maybeSingle(),
  ]);

  const phone =
    (typeof landlord?.notification_phone === "string" &&
    landlord.notification_phone.trim()
      ? landlord.notification_phone.trim()
      : null) ??
    (typeof tenant?.phone === "string" && tenant.phone.trim()
      ? tenant.phone.trim()
      : null) ??
    "—";

  return (
    <div className="space-y-6">
      <h1 className={portalSectionTitleClassName}>My Account</h1>

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Profile</h2>
        <dl className="mt-4 grid max-w-md gap-4 text-sm">
          <div>
            <dt className="font-medium text-slate-500">Business name</dt>
            <dd className="mt-1 text-slate-900">{session.fullName}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Login email</dt>
            <dd className="mt-1 text-slate-900">{session.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Phone</dt>
            <dd className="mt-1 text-slate-900">{phone}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-slate-600">
          Business logo and workspace details are managed under{" "}
          <Link
            href="/landlord-portal/administration/workspace"
            className="font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
          >
            Administration → Workspace Settings
          </Link>
          .
        </p>
      </section>

      <PushNotificationsSettings persona="landlord" />

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Two-factor authentication</h2>
        <p className="mt-1 text-sm text-slate-600">
          Optional extra protection for your Landlord Portal sign-in.
        </p>
        <Link
          href="/landlord-portal/account/mfa"
          className={`mt-4 inline-flex ${portalPrimaryButtonClassName}`}
        >
          Manage two-factor settings
        </Link>
      </section>

      <LandlordPortalAccountChangePasswordForm />
    </div>
  );
}
