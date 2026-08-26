"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  DEFAULT_FACILITY_MANAGER_CAPABILITIES,
  DAVORS_MANAGED_FM_COLLECTION_CAPABILITY_ERROR,
} from "@/utils/facility-manager-capabilities";
import {
  portalDangerButtonClassName,
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

type PropertyOption = {
  propertyId: string;
  name: string;
};

type FacilityManagerRow = {
  facility_manager_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  status: "invited" | "active" | "revoked";
  can_manage_maintenance: boolean;
  can_manage_complaints: boolean;
  can_manage_inspections: boolean;
  can_log_services: boolean;
  can_collect_rent: boolean;
  can_collect_charges: boolean;
  invited_at: string | null;
  activated_at: string | null;
  revoked_at: string | null;
  has_portal_account: boolean;
  invite_expires_at: string | null;
  properties: Array<{ property_id: string; name: string }>;
};

type CapabilityForm = {
  can_manage_maintenance: boolean;
  can_manage_complaints: boolean;
  can_manage_inspections: boolean;
  can_log_services: boolean;
  can_collect_rent: boolean;
  can_collect_charges: boolean;
};

type InviteForm = {
  full_name: string;
  email: string;
  property_ids: string[];
  capabilities: CapabilityForm;
};

const CAPABILITY_FIELDS: Array<{
  key: keyof CapabilityForm;
  label: string;
  collection?: boolean;
}> = [
  { key: "can_manage_maintenance", label: "Maintenance" },
  { key: "can_manage_complaints", label: "Complaints" },
  { key: "can_manage_inspections", label: "Inspections" },
  { key: "can_log_services", label: "Services" },
  { key: "can_collect_rent", label: "Collect rent", collection: true },
  { key: "can_collect_charges", label: "Collect charges", collection: true },
];

function defaultCapabilities(isDavorsManaged: boolean): CapabilityForm {
  const base = { ...DEFAULT_FACILITY_MANAGER_CAPABILITIES };
  if (isDavorsManaged) {
    base.can_collect_rent = false;
    base.can_collect_charges = false;
  }
  return base;
}

function emptyInviteForm(isDavorsManaged: boolean): InviteForm {
  return {
    full_name: "",
    email: "",
    property_ids: [],
    capabilities: defaultCapabilities(isDavorsManaged),
  };
}

function formatStatus(status: FacilityManagerRow["status"]): string {
  if (status === "invited") return "Invited";
  if (status === "active") return "Active";
  return "Revoked";
}

function formatCapabilitySummary(row: FacilityManagerRow): string {
  const labels: string[] = [];
  if (row.can_manage_maintenance) labels.push("Maint");
  if (row.can_manage_complaints) labels.push("Complaints");
  if (row.can_manage_inspections) labels.push("Inspections");
  if (row.can_log_services) labels.push("Services");
  if (row.can_collect_rent) labels.push("Rent");
  if (row.can_collect_charges) labels.push("Charges");
  return labels.length > 0 ? labels.join(" · ") : "—";
}

function formatPropertySummary(
  properties: FacilityManagerRow["properties"],
): string {
  if (properties.length === 0) return "—";
  if (properties.length <= 2) {
    return properties.map((p) => p.name).join(", ");
  }
  return `${properties
    .slice(0, 2)
    .map((p) => p.name)
    .join(", ")} +${properties.length - 2} more`;
}

type LandlordPortalFacilityManagersListProps = {
  properties: PropertyOption[];
  isDavorsManaged: boolean;
};

export default function LandlordPortalFacilityManagersList({
  properties,
  isDavorsManaged,
}: LandlordPortalFacilityManagersListProps) {
  const router = useRouter();
  const [rows, setRows] = useState<FacilityManagerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingRow, setEditingRow] = useState<FacilityManagerRow | null>(null);
  const [inviteForm, setInviteForm] = useState(() =>
    emptyInviteForm(isDavorsManaged),
  );
  const [editForm, setEditForm] = useState<{
    property_ids: string[];
    capabilities: CapabilityForm;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/landlord-portal/facility-managers");
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      facility_managers?: FacilityManagerRow[];
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to load facility managers.");
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(payload?.facility_managers ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  function openInviteModal() {
    setError(null);
    setSuccess(null);
    setInviteForm(emptyInviteForm(isDavorsManaged));
    setShowInviteModal(true);
  }

  function openEditModal(row: FacilityManagerRow) {
    setError(null);
    setSuccess(null);
    setEditingRow(row);
    setEditForm({
      property_ids: row.properties.map((p) => p.property_id),
      capabilities: {
        can_manage_maintenance: row.can_manage_maintenance,
        can_manage_complaints: row.can_manage_complaints,
        can_manage_inspections: row.can_manage_inspections,
        can_log_services: row.can_log_services,
        can_collect_rent: isDavorsManaged ? false : row.can_collect_rent,
        can_collect_charges: isDavorsManaged ? false : row.can_collect_charges,
      },
    });
  }

  function closeModals() {
    setShowInviteModal(false);
    setEditingRow(null);
    setEditForm(null);
    setSubmitting(false);
  }

  function togglePropertyId(
    current: string[],
    propertyId: string,
    checked: boolean,
  ): string[] {
    if (checked) {
      return current.includes(propertyId)
        ? current
        : [...current, propertyId];
    }
    return current.filter((id) => id !== propertyId);
  }

  async function handleInviteSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/landlord-portal/facility-managers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: inviteForm.full_name.trim(),
        email: inviteForm.email.trim(),
        property_ids: inviteForm.property_ids,
        ...inviteForm.capabilities,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to send invite.");
      setSubmitting(false);
      return;
    }

    setSuccess(`Invite sent to ${inviteForm.email.trim()}.`);
    closeModals();
    await loadRows();
    router.refresh();
  }

  async function handleEditSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingRow || !editForm) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const response = await fetch(
      `/api/landlord-portal/facility-managers/${editingRow.facility_manager_id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_ids: editForm.property_ids,
          ...editForm.capabilities,
        }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update facility manager.");
      setSubmitting(false);
      return;
    }

    setSuccess(`Updated ${editingRow.full_name}.`);
    closeModals();
    await loadRows();
    router.refresh();
  }

  async function handleResendInvite(row: FacilityManagerRow) {
    setError(null);
    setSuccess(null);
    setActionId(row.facility_manager_id);

    const response = await fetch(
      "/api/landlord-portal/facility-managers/resend-invite",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facility_manager_id: row.facility_manager_id,
        }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to resend invite.");
      setActionId(null);
      return;
    }

    setSuccess(`Invite resent to ${row.email}.`);
    setActionId(null);
    await loadRows();
    router.refresh();
  }

  async function handleRevoke(row: FacilityManagerRow) {
    if (
      !window.confirm(
        `Revoke facility manager access for ${row.full_name}? They will no longer be able to sign in.`,
      )
    ) {
      return;
    }

    setError(null);
    setSuccess(null);
    setActionId(row.facility_manager_id);

    const response = await fetch(
      `/api/landlord-portal/facility-managers/${row.facility_manager_id}/revoke`,
      { method: "POST" },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to revoke facility manager.");
      setActionId(null);
      return;
    }

    setSuccess(`Access revoked for ${row.full_name}.`);
    setActionId(null);
    await loadRows();
    router.refresh();
  }

  function renderCapabilityCheckboxes(
    capabilities: CapabilityForm,
    onChange: (next: CapabilityForm) => void,
  ) {
    const visibleFields = CAPABILITY_FIELDS.filter(
      (field) => !isDavorsManaged || !field.collection,
    );

    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Capabilities</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {visibleFields.map((field) => (
            <label
              key={field.key}
              className="flex items-center gap-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={capabilities[field.key]}
                onChange={(event) =>
                  onChange({
                    ...capabilities,
                    [field.key]: event.target.checked,
                  })
                }
                className="rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
              />
              {field.label}
            </label>
          ))}
        </div>
        {isDavorsManaged ? (
          <p className="text-xs text-slate-500">
            {DAVORS_MANAGED_FM_COLLECTION_CAPABILITY_ERROR}
          </p>
        ) : null}
      </div>
    );
  }

  function renderPropertyCheckboxes(
    selectedIds: string[],
    onChange: (next: string[]) => void,
  ) {
    if (properties.length === 0) {
      return (
        <p className="text-sm text-slate-600">
          Add a property first before assigning a facility manager.
        </p>
      );
    }

    return (
      <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3">
        {properties.map((property) => (
          <label
            key={property.propertyId}
            className="flex items-center gap-2 text-sm text-slate-700"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(property.propertyId)}
              onChange={(event) =>
                onChange(
                  togglePropertyId(
                    selectedIds,
                    property.propertyId,
                    event.target.checked,
                  ),
                )
              }
              className="rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
            />
            {property.name}
          </label>
        ))}
      </div>
    );
  }

  function renderModalShell(
    title: string,
    onSubmit: (event: React.FormEvent) => void,
    children: React.ReactNode,
  ) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="fm-modal-title"
          className={`${portalSectionClassName} max-h-[90vh] w-full max-w-lg overflow-y-auto`}
        >
          <h2 id="fm-modal-title" className={portalSectionTitleClassName}>
            {title}
          </h2>
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            {children}
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={submitting}
                className={portalPrimaryButtonClassName}
              >
                {submitting ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={closeModals}
                className={portalSecondaryButtonClassName}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openInviteModal}
          disabled={properties.length === 0}
          className={portalPrimaryButtonClassName}
        >
          Invite Facility Manager
        </button>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      {loading ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">Loading facility managers…</p>
        </section>
      ) : rows.length === 0 ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">
            No facility managers yet. Invite someone to help manage your
            properties.
          </p>
        </section>
      ) : (
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Name</th>
                <th className={scrollableTableThClassName}>Email</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Properties</th>
                <th className={scrollableTableThClassName}>Capabilities</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row, index) => {
                const canEdit = row.status !== "revoked";
                const canResend =
                  row.status === "invited" && !row.has_portal_account;
                const canRevoke = row.status === "active";

                return (
                  <tr
                    key={row.facility_manager_id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {row.full_name}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{row.email}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatStatus(row.status)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatPropertySummary(row.properties)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {formatCapabilitySummary(row)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex flex-wrap items-center gap-1.5">
                        {canEdit ? (
                          <button
                            type="button"
                            className={portalSecondaryButtonClassName}
                            disabled={actionId !== null}
                            onClick={() => openEditModal(row)}
                          >
                            Edit
                          </button>
                        ) : null}

                        {canResend ? (
                          <button
                            type="button"
                            className={portalSecondaryButtonClassName}
                            disabled={actionId !== null}
                            onClick={() => handleResendInvite(row)}
                          >
                            {actionId === row.facility_manager_id
                              ? "Sending…"
                              : "Resend invite"}
                          </button>
                        ) : null}

                        {canRevoke ? (
                          <button
                            type="button"
                            className={portalDangerButtonClassName}
                            disabled={actionId !== null}
                            onClick={() => handleRevoke(row)}
                          >
                            {actionId === row.facility_manager_id
                              ? "Working…"
                              : "Revoke"}
                          </button>
                        ) : null}

                        {!canEdit && !canResend && !canRevoke ? (
                          <span className="text-xs text-slate-500">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      )}

      {showInviteModal
        ? renderModalShell("Invite Facility Manager", handleInviteSubmit, (
            <>
              <div>
                <label htmlFor="fm-invite-full-name" className={portalLabelClassName}>
                  Full name
                </label>
                <input
                  id="fm-invite-full-name"
                  required
                  type="text"
                  value={inviteForm.full_name}
                  onChange={(event) =>
                    setInviteForm((current) => ({
                      ...current,
                      full_name: event.target.value,
                    }))
                  }
                  className={portalInputClassName}
                />
              </div>
              <div>
                <label htmlFor="fm-invite-email" className={portalLabelClassName}>
                  Email
                </label>
                <input
                  id="fm-invite-email"
                  required
                  type="email"
                  value={inviteForm.email}
                  onChange={(event) =>
                    setInviteForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  className={portalInputClassName}
                />
              </div>
              <div>
                <p className={portalLabelClassName}>Assigned properties</p>
                {renderPropertyCheckboxes(
                  inviteForm.property_ids,
                  (property_ids) =>
                    setInviteForm((current) => ({ ...current, property_ids })),
                )}
              </div>
              {renderCapabilityCheckboxes(
                inviteForm.capabilities,
                (capabilities) =>
                  setInviteForm((current) => ({ ...current, capabilities })),
              )}
            </>
          ))
        : null}

      {editingRow && editForm
        ? renderModalShell(
            `Edit ${editingRow.full_name}`,
            handleEditSubmit,
            <>
              <div>
                <p className={portalLabelClassName}>Assigned properties</p>
                {renderPropertyCheckboxes(editForm.property_ids, (property_ids) =>
                  setEditForm((current) =>
                    current ? { ...current, property_ids } : current,
                  ),
                )}
              </div>
              {renderCapabilityCheckboxes(
                editForm.capabilities,
                (capabilities) =>
                  setEditForm((current) =>
                    current ? { ...current, capabilities } : current,
                  ),
              )}
            </>,
          )
        : null}
    </div>
  );
}
