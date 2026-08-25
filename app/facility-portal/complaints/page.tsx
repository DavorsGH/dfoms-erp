import { redirect } from "next/navigation";
import { getFacilityManagerSession } from "@/utils/facility-portal-auth";
import {
  portalCompactSectionClassName,
  portalPageClassName,
  portalSectionTitleClassName,
} from "../portal-ui";

export default async function FacilityPortalComplaintsPlaceholderPage() {
  const session = await getFacilityManagerSession();
  if (!session) {
    redirect("/facility-portal/login");
  }
  if (!session.canManageComplaints) {
    redirect("/facility-portal/dashboard");
  }

  return (
    <div className={portalPageClassName}>
      <section className={portalCompactSectionClassName}>
        <h1 className={portalSectionTitleClassName}>Complaints</h1>
        <p className="text-sm text-slate-600">
          Complaints screens are next. Maintenance and Services are available
          now from the sidebar.
        </p>
      </section>
    </div>
  );
}
