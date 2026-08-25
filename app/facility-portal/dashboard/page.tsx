import { redirect } from "next/navigation";
import { getFacilityManagerSession } from "@/utils/facility-portal-auth";

export default async function FacilityPortalDashboardPage() {
  const session = await getFacilityManagerSession();
  if (!session) {
    redirect("/facility-portal/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-md border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0f2744]">
          Facility Manager Portal
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Welcome, {session.fullName}
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          You are signed in. Full maintenance, complaints, services, and
          collections screens will arrive in a later build.
        </p>
        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium text-slate-900">
              {session.email ?? "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-slate-100 pb-2">
            <dt className="text-slate-500">Assigned properties</dt>
            <dd className="font-medium text-slate-900">
              {session.assignedPropertyIds.length}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
