"use client";

import { useCallback, useEffect, useState } from "react";
import LoginAccessCard from "./login-access-card";
import { parseApiErrorResponse } from "@/utils/parse-api-error";

type FmRow = {
  facilityManagerId: string;
  fullName: string;
  email: string;
  authUserExists: boolean;
  loginEmail: string | null;
  lastSignInAt: string | null;
  isSuspended: boolean;
};

type FacilityManagersLoginSectionProps = {
  tenantId: string;
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FacilityManagersLoginSection({
  tenantId,
}: FacilityManagersLoginSectionProps) {
  const [rows, setRows] = useState<FmRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/portal-login-access/facility-managers?tenant_id=${encodeURIComponent(tenantId)}`,
      );
      if (!response.ok) {
        setError(
          await parseApiErrorResponse(
            response,
            "Failed to load facility managers",
          ),
        );
        setRows([]);
        return;
      }
      const payload = (await response.json()) as {
        facility_managers?: Array<{
          facilityManagerId: string;
          fullName: string;
          email: string;
          authUserExists: boolean;
          loginEmail: string | null;
          lastSignInAt: string | null;
          isSuspended: boolean;
        }>;
      };
      setRows(payload.facility_managers ?? []);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const managing = rows.find((row) => row.facilityManagerId === managingId);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-base font-semibold text-[#0f2744]">
        Facility managers
      </h3>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {!loading && !error && rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No facility managers for this landlord.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Login email</th>
                <th className="px-2 py-2 font-medium">Auth</th>
                <th className="px-2 py-2 font-medium">Last sign-in</th>
                <th className="px-2 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.facilityManagerId}
                  className="border-b border-slate-100 text-slate-700"
                >
                  <td className="px-2 py-2">{row.fullName}</td>
                  <td className="px-2 py-2">
                    {row.loginEmail ?? row.email ?? "—"}
                  </td>
                  <td className="px-2 py-2">
                    {row.authUserExists ? "Exists" : "None"}
                    {row.isSuspended ? " · Suspended" : ""}
                  </td>
                  <td className="px-2 py-2">
                    {formatDateTime(row.lastSignInAt)}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      onClick={() => setManagingId(row.facilityManagerId)}
                    >
                      Manage login
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {managing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fm-login-access-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setManagingId(null);
              void load();
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3
                  id="fm-login-access-title"
                  className="text-lg font-semibold text-[#0f2744]"
                >
                  Login access
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {managing.fullName}
                </p>
              </div>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setManagingId(null);
                  void load();
                }}
              >
                Close
              </button>
            </div>
            <LoginAccessCard
              asCard={false}
              apiBase="admin"
              persona="facility_manager"
              tenantId={tenantId}
              facilityManagerId={managing.facilityManagerId}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
