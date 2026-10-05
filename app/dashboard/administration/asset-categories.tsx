"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { formatCantDeleteAlertTitle } from "@/utils/delete-blocked-messaging";
import { getNamedLookupDeleteErrorMessage } from "@/utils/named-lookup-delete-errors";
import {
  assertTenantIdForMutation,
  tenantScopedDelete,
  tenantScopedUpdate,
} from "@/utils/tenant-scoped-supabase";
import { useOfflineWriteBlocked } from "@/hooks/use-online-status";
import { invalidateReferenceLookupsAfterWrite } from "@/lib/client-cache/dashboard-summary-cache";
import { resolveClientCacheSession } from "@/lib/client-cache/session-context";
import {
  expenseCategoryNameTaken,
  LOOKUP_HIDDEN_LABEL_SUFFIX,
  LOOKUP_SETTINGS_NOTE,
} from "./lookup-settings-shared";
import {
  fetchAssetCategoryDeleteUsage,
  formatAssetCategoryDeleteBlockedMessage,
} from "./lookup-settings-usage";
import { useLookupSettingsFeedback } from "./lookup-settings-feedback";

type AssetCategoryRow = { name: string; is_active?: boolean };

type AssetCategoriesProps = {
  tenantId: string;
  initialCategories: AssetCategoryRow[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function AssetCategories({
  tenantId,
  initialCategories,
  fetchError,
}: AssetCategoriesProps) {
  const supabase = createClient();
  const scopedTenantId = assertTenantIdForMutation(tenantId);
  const { isOffline, offlineWriteMessage } = useOfflineWriteBlocked();
  const { showActionError, showActionSuccess, preserveScroll } =
    useLookupSettingsFeedback(fetchError);
  const [categories, setCategories] = useState(initialCategories);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function invalidateReferenceCache() {
    const session = await resolveClientCacheSession();
    if (session) {
      await invalidateReferenceLookupsAfterWrite(session);
    }
  }

  async function refreshCategories() {
    await preserveScroll(async () => {
      const { data, error: refreshError } = await supabase
        .from("asset_categories")
        .select("name, is_active")
        .order("name", { ascending: true });

      if (refreshError) {
        showActionError(refreshError);
        return;
      }

      setCategories((data as AssetCategoryRow[] | null) ?? []);
    });
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    await preserveScroll(async () => {
      if (isOffline) {
        showActionError(offlineWriteMessage);
        return;
      }
      const trimmed = newCategoryName.trim();
      if (!trimmed) {
        return;
      }
      if (expenseCategoryNameTaken(categories, trimmed)) {
        showActionError(`An asset category named "${trimmed}" already exists.`);
        return;
      }

      setLoading(true);
      const { error: insertError } = await supabase
        .from("asset_categories")
        .insert({ tenant_id: scopedTenantId, name: trimmed, is_active: true });

      if (insertError) {
        showActionError(insertError);
        setLoading(false);
        return;
      }

      setNewCategoryName("");
      await refreshCategories();
      await invalidateReferenceCache();
      setLoading(false);
      showActionSuccess("Category added.");
    });
  }

  async function saveEdit(previousName: string) {
    await preserveScroll(async () => {
      const trimmed = editDraft.trim();
      if (!trimmed || trimmed === previousName) {
        setEditingName(null);
        return;
      }
      if (expenseCategoryNameTaken(categories, trimmed, previousName)) {
        showActionError(`An asset category named "${trimmed}" already exists.`);
        return;
      }
      if (isOffline) {
        showActionError(offlineWriteMessage);
        return;
      }

      setBusyKey(`edit-asset-cat:${previousName}`);
      const { error: updateError } = await tenantScopedUpdate(
        supabase,
        "asset_categories",
        scopedTenantId,
        { name: trimmed },
        { name: previousName },
      );

      if (updateError) {
        showActionError(updateError);
        setBusyKey(null);
        return;
      }

      setEditingName(null);
      await refreshCategories();
      await invalidateReferenceCache();
      setBusyKey(null);
      showActionSuccess("Changes saved.");
    });
  }

  async function toggleHidden(categoryName: string, hide: boolean) {
    await preserveScroll(async () => {
      if (isOffline) {
        showActionError(offlineWriteMessage);
        return;
      }
      setBusyKey(`hide-asset-cat:${categoryName}`);
      const { error: updateError } = await tenantScopedUpdate(
        supabase,
        "asset_categories",
        scopedTenantId,
        { is_active: !hide },
        { name: categoryName },
      );
      if (updateError) {
        showActionError(updateError);
      } else {
        await refreshCategories();
        await invalidateReferenceCache();
        showActionSuccess(
          hide
            ? "Hidden from new entries."
            : "Shown in new entry lists again.",
        );
      }
      setBusyKey(null);
    });
  }

  async function deleteCategory(categoryName: string) {
    await preserveScroll(async () => {
      if (isOffline) {
        showActionError(offlineWriteMessage);
        return;
      }
      setBusyKey(`delete-asset-cat:${categoryName}`);
      try {
        const usageLines = await fetchAssetCategoryDeleteUsage(
          supabase,
          categoryName,
        );
        const blockMessage = formatAssetCategoryDeleteBlockedMessage(
          categoryName,
          usageLines,
        );
        if (blockMessage) {
          showActionError(blockMessage, {
            title: formatCantDeleteAlertTitle("asset category"),
          });
          setBusyKey(null);
          return;
        }
        if (
          !(await confirmDialog({
            message: `Delete asset category "${categoryName}"? This cannot be undone.`,
            tone: "danger",
            confirmLabel: "Delete",
          }))
        ) {
          setBusyKey(null);
          return;
        }
        const { error: deleteError } = await tenantScopedDelete(
          supabase,
          "asset_categories",
          scopedTenantId,
          { name: categoryName },
        );
        if (deleteError) {
          showActionError(
            getNamedLookupDeleteErrorMessage(deleteError, "asset category"),
            { title: formatCantDeleteAlertTitle("asset category") },
          );
        } else {
          await refreshCategories();
          await invalidateReferenceCache();
          showActionSuccess("Category deleted.");
        }
      } catch (usageError) {
        showActionError(usageError);
      }
      setBusyKey(null);
    });
  }

  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold text-[#0f2744]">
          Asset categories
        </h2>
        <p className="mb-4 text-sm text-slate-600">{LOOKUP_SETTINGS_NOTE}</p>

        {isOffline && (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {offlineWriteMessage}
          </p>
        )}

        <form
          onSubmit={handleAdd}
          className="mb-6 flex flex-col gap-3 sm:flex-row"
        >
          <input
            type="text"
            required
            value={newCategoryName}
            onChange={(event) => setNewCategoryName(event.target.value)}
            placeholder="New category name"
            className={inputClassName}
          />
          <button
            type="submit"
            disabled={loading || isOffline}
            className="shrink-0 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Adding…" : "Add category"}
          </button>
        </form>

        {categories.length === 0 ? (
          <p className="text-sm text-slate-500">No asset categories yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
            {categories.map((category) => (
              <li
                key={category.name}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-slate-700"
              >
                {editingName === category.name ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      className={`${inputClassName} max-w-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => void saveEdit(category.name)}
                      disabled={busyKey === `edit-asset-cat:${category.name}`}
                      className="rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingName(null)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <span>
                      {category.name}
                      {category.is_active === false
                        ? LOOKUP_HIDDEN_LABEL_SUFFIX
                        : ""}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingName(category.name);
                          setEditDraft(category.name);
                        }}
                        disabled={isOffline}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteCategory(category.name)}
                        disabled={
                          isOffline ||
                          busyKey === `delete-asset-cat:${category.name}`
                        }
                        className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void toggleHidden(
                            category.name,
                            category.is_active !== false,
                          )
                        }
                        disabled={
                          isOffline ||
                          busyKey === `hide-asset-cat:${category.name}`
                        }
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {category.is_active === false
                          ? "Show again"
                          : "Hide from new entries"}
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
