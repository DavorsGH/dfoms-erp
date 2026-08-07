import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getMfaSettingsForCurrentUser } from "@/lib/mfa/enrollment-actions";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import PortalMfaSettingsClient from "./mfa-settings-client";

export default async function PortalMfaSettingsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/portal/login");
  }

  const settings = await getMfaSettingsForCurrentUser("lessee");

  return (
    <section className={portalSectionClassName}>
      <Link
        href="/portal/dashboard"
        className="text-sm text-slate-500 underline hover:text-slate-800"
      >
        ← Back to dashboard
      </Link>
      <h1 className={`${portalSectionTitleClassName} mt-2`}>
        Two-factor authentication
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        Optional extra sign-in protection for the Tenant Portal.
      </p>
      <div className="mt-6">
        <PortalMfaSettingsClient initialSettings={settings} />
      </div>
    </section>
  );
}
