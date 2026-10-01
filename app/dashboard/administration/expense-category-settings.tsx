"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { NamedLookup } from "../lookup-types";
import { useOfflineWriteBlocked } from "@/hooks/use-online-status";
import { invalidateReferenceLookupsAfterWrite } from "@/lib/client-cache/dashboard-summary-cache";
import { resolveClientCacheSession } from "@/lib/client-cache/session-context";
import type { ExpenseSubcategoryLookup } from "../finance/expense-register-utils";
import {
  EXPENSE_SUBCATEGORIES_LOOKUP_SELECT,
  findLinkedExpenseSubcategoryInCategory,
  findUnlinkedExpenseSubcategoryByName,
} from "../finance/expense-register-utils";
import {
  expenseCategoryNameTaken,
  LOOKUP_HIDDEN_LABEL_SUFFIX,
  LOOKUP_SETTINGS_NOTE,
  namedLookupSelectOptionsForCreate,
} from "./lookup-settings-shared";
import {
  fetchExpenseCategoryDeleteUsage,
  formatExpenseCategoryDeleteBlockedMessage,
} from "./lookup-settings-usage";
import { adminDeleteExpenseSubcategory } from "./lookup-settings-subcategory-delete";
import {
  confirmRemoveUnlinkedDuplicateMessage,
  formatUnlinkedDuplicateOfLabel,
  isUnlinkedDuplicateOfLinkedSubcategory,
  linkedExpenseCategoriesForUnlinkedSubcategoryName,
} from "./unlinked-expense-subcategory-utils";

type ExpenseCategoryRow = NamedLookup & { is_active?: boolean };

type ExpenseCategorySettingsProps = {
  initialCategories: ExpenseCategoryRow[];
  initialSubcategories: ExpenseSubcategoryLookup[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function ExpenseCategorySettings({
  initialCategories,
  initialSubcategories,
  fetchError,
}: ExpenseCategorySettingsProps) {
  const supabase = createClient();
  const { isOffline, offlineWriteMessage } = useOfflineWriteBlocked();
  const [categories, setCategories] = useState(initialCategories);
  const [subcategories, setSubcategories] =
    useState<ExpenseSubcategoryLookup[]>(initialSubcategories);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newSubNameByCategory, setNewSubNameByCategory] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [categoryRenameDraft, setCategoryRenameDraft] = useState("");
  const [renamingSubId, setRenamingSubId] = useState<string | null>(null);
  const [subRenameDraft, setSubRenameDraft] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [linkCategoryBySubId, setLinkCategoryBySubId] = useState<
    Record<string, string>
  >({});
  const [duplicateRemoveOffer, setDuplicateRemoveOffer] = useState<{
    subId: string;
    subName: string;
    categories: string[];
  } | null>(null);

  const categoryOptionsForLink = useMemo(
    () => namedLookupSelectOptionsForCreate(categories, false, ""),
    [categories],
  );

  const subcategoriesByCategory = useMemo(() => {
    const map = new Map<string, ExpenseSubcategoryLookup[]>();
    for (const row of subcategories) {
      const category = (row.expense_category ?? "").trim();
      if (!category) {
        continue;
      }
      const list = map.get(category) ?? [];
      list.push(row);
      map.set(category, list);
    }
    for (const list of map.values()) {
      list.sort((left, right) => left.name.localeCompare(right.name));
    }
    return map;
  }, [subcategories]);

  const unlinkedSubcategories = useMemo(
    () =>
      subcategories
        .filter((row) => !(row.expense_category ?? "").trim())
        .sort((left, right) => left.name.localeCompare(right.name)),
    [subcategories],
  );

  const unlinkedDuplicateCategoriesBySubId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of unlinkedSubcategories) {
      map.set(
        row.id,
        linkedExpenseCategoriesForUnlinkedSubcategoryName(
          row.name,
          subcategories,
        ),
      );
    }
    return map;
  }, [subcategories, unlinkedSubcategories]);

  function applySubcategoryLinkedLocally(
    subcategoryId: string,
    categoryName: string,
    displayName: string,
  ) {
    setSubcategories((prev) =>
      prev.map((row) =>
        row.id === subcategoryId
          ? {
              ...row,
              name: displayName,
              expense_category: categoryName,
              is_active: true,
            }
          : row,
      ),
    );
  }

  async function invalidateReferenceCache() {
    const session = await resolveClientCacheSession();
    if (session) {
      await invalidateReferenceLookupsAfterWrite(session);
    }
  }

  async function refreshAll() {
    const [categoriesResult, subcategoriesResult] = await Promise.all([
      supabase
        .from("expense_categories")
        .select("name, is_active")
        .order("name", { ascending: true }),
      supabase
        .from("expense_subcategories")
        .select(EXPENSE_SUBCATEGORIES_LOOKUP_SELECT)
        .order("expense_category", { ascending: true })
        .order("name", { ascending: true }),
    ]);

    if (categoriesResult.error || subcategoriesResult.error) {
      setError(
        categoriesResult.error?.message ??
          subcategoriesResult.error?.message ??
          "Failed to refresh.",
      );
      return;
    }

    setCategories((categoriesResult.data as ExpenseCategoryRow[]) ?? []);
    setSubcategories(
      ((subcategoriesResult.data as ExpenseSubcategoryLookup[] | null) ?? []).map(
        (row) => ({
          id: String(row.id),
          name: row.name,
          expense_category: row.expense_category ?? null,
          is_active: row.is_active ?? true,
        }),
      ),
    );
    setError(null);
  }

  async function handleAddCategory(event: React.FormEvent) {
    event.preventDefault();
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      return;
    }
    if (expenseCategoryNameTaken(categories, trimmed)) {
      setError(`An expense category named "${trimmed}" already exists.`);
      return;
    }

    setLoading(true);
    setError(null);

    const { error: insertError } = await supabase
      .from("expense_categories")
      .insert({ name: trimmed, is_active: true });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setNewCategoryName("");
    await refreshAll();
    await invalidateReferenceCache();
    setLoading(false);
  }

  type LinkSubcategoryResult =
    | { outcome: "linked" }
    | { outcome: "duplicate"; categoryName: string }
    | { outcome: "failed"; message: string };

  async function linkSubcategoryToCategory(options: {
    categoryName: string;
    subcategoryName: string;
    unlinkedRowId?: string;
    busyKey: string;
  }): Promise<LinkSubcategoryResult> {
    const categoryName = options.categoryName.trim();
    const trimmed = options.subcategoryName.trim();
    if (!categoryName || !trimmed) {
      return {
        outcome: "failed",
        message: "Category and sub-category name are required.",
      };
    }

    if (isOffline) {
      setError(offlineWriteMessage);
      return { outcome: "failed", message: offlineWriteMessage };
    }

    setBusyKey(options.busyKey);
    setError(null);
    setDuplicateRemoveOffer(null);

    const existingLinked = findLinkedExpenseSubcategoryInCategory(
      subcategories,
      categoryName,
      trimmed,
    );
    if (existingLinked) {
      if (options.unlinkedRowId) {
        setBusyKey(null);
        return { outcome: "duplicate", categoryName };
      }
      const message = `"${trimmed}" already exists under ${categoryName}.`;
      setError(message);
      setBusyKey(null);
      return { outcome: "failed", message };
    }

    const unlinkedRow =
      (options.unlinkedRowId
        ? subcategories.find(
            (row) =>
              row.id === options.unlinkedRowId &&
              !(row.expense_category ?? "").trim(),
          )
        : undefined) ??
      findUnlinkedExpenseSubcategoryByName(subcategories, trimmed);

    if (unlinkedRow) {
      const { data, error: updateError } = await supabase
        .from("expense_subcategories")
        .update({
          expense_category: categoryName,
          is_active: true,
        })
        .eq("id", unlinkedRow.id)
        .is("expense_category", null)
        .select("id, name, expense_category, is_active")
        .maybeSingle();

      if (updateError) {
        setError(updateError.message);
        setBusyKey(null);
        return { outcome: "failed", message: updateError.message };
      }

      if (!data) {
        const message =
          "Could not link sub-category — it may have been updated elsewhere. Refresh and try again.";
        setError(message);
        setBusyKey(null);
        await refreshAll();
        return { outcome: "failed", message };
      }

      applySubcategoryLinkedLocally(
        unlinkedRow.id,
        categoryName,
        String(data.name),
      );
      await invalidateReferenceCache();
      setBusyKey(null);
      return { outcome: "linked" };
    }

    const { error: insertError } = await supabase
      .from("expense_subcategories")
      .insert({
        name: trimmed,
        expense_category: categoryName,
        is_active: true,
      });

    if (insertError) {
      setError(insertError.message);
      setBusyKey(null);
      return { outcome: "failed", message: insertError.message };
    }

    await refreshAll();
    await invalidateReferenceCache();
    setBusyKey(null);
    return { outcome: "linked" };
  }

  async function handleAddSubcategory(categoryName: string) {
    const trimmed = (newSubNameByCategory[categoryName] ?? "").trim();
    if (!trimmed) {
      return;
    }

    const linked = await linkSubcategoryToCategory({
      categoryName,
      subcategoryName: trimmed,
      busyKey: `add-sub:${categoryName}`,
    });

    if (linked.outcome === "linked") {
      setNewSubNameByCategory((prev) => ({ ...prev, [categoryName]: "" }));
    }
  }

  async function executeAdminDeleteSubcategory(
    sub: ExpenseSubcategoryLookup,
  ): Promise<boolean> {
    setBusyKey(`delete-sub:${sub.id}`);
    setError(null);
    const result = await adminDeleteExpenseSubcategory(supabase, sub.id);
    if (!result.ok) {
      setError(result.error);
      setBusyKey(null);
      return false;
    }
    setDuplicateRemoveOffer(null);
    await refreshAll();
    await invalidateReferenceCache();
    setBusyKey(null);
    return true;
  }

  async function removeUnlinkedDuplicateSubcategory(
    sub: ExpenseSubcategoryLookup,
  ) {
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }
    const linkedCategories =
      unlinkedDuplicateCategoriesBySubId.get(sub.id) ?? [];
    if (linkedCategories.length === 0) {
      setError("This row is not an unlinked duplicate of a linked sub-category.");
      return;
    }
    const message = confirmRemoveUnlinkedDuplicateMessage(
      sub.name,
      linkedCategories,
    );
    if (!window.confirm(message)) {
      setError(message);
      return;
    }
    await executeAdminDeleteSubcategory(sub);
  }

  async function handleLinkUnlinkedSubcategory(sub: ExpenseSubcategoryLookup) {
    const categoryName = (linkCategoryBySubId[sub.id] ?? "").trim();
    if (!categoryName) {
      setError("Choose a category before linking.");
      return;
    }

    const result = await linkSubcategoryToCategory({
      categoryName,
      subcategoryName: sub.name,
      unlinkedRowId: sub.id,
      busyKey: `link-sub:${sub.id}`,
    });

    if (result.outcome === "linked") {
      setLinkCategoryBySubId((prev) => {
        const next = { ...prev };
        delete next[sub.id];
        return next;
      });
      setDuplicateRemoveOffer(null);
      return;
    }

    if (result.outcome === "duplicate") {
      const linkedCategories =
        unlinkedDuplicateCategoriesBySubId.get(sub.id) ?? [result.categoryName];
      const message = confirmRemoveUnlinkedDuplicateMessage(
        sub.name,
        linkedCategories,
      );
      setError(message);
      setDuplicateRemoveOffer({
        subId: sub.id,
        subName: sub.name,
        categories: linkedCategories,
      });
      return;
    }

    if (result.outcome === "failed" && result.message) {
      setError(result.message);
    }
  }

  async function saveCategoryRename(previousName: string) {
    const trimmed = categoryRenameDraft.trim();
    if (!trimmed || trimmed === previousName) {
      setRenamingCategory(null);
      return;
    }
    if (expenseCategoryNameTaken(categories, trimmed, previousName)) {
      setError(`An expense category named "${trimmed}" already exists.`);
      return;
    }
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }

    setBusyKey(`rename-cat:${previousName}`);
    setError(null);

    const { error: updateError } = await supabase
      .from("expense_categories")
      .update({ name: trimmed })
      .eq("name", previousName);

    if (updateError) {
      setError(updateError.message);
      setBusyKey(null);
      return;
    }

    const { error: relinkError } = await supabase
      .from("expense_subcategories")
      .update({ expense_category: trimmed })
      .eq("expense_category", previousName);

    if (relinkError) {
      setError(relinkError.message);
      setBusyKey(null);
      return;
    }

    setRenamingCategory(null);
    await refreshAll();
    await invalidateReferenceCache();
    setBusyKey(null);
  }

  async function saveSubRename(sub: ExpenseSubcategoryLookup) {
    const trimmed = subRenameDraft.trim();
    if (!trimmed || trimmed === sub.name) {
      setRenamingSubId(null);
      return;
    }
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }

    setBusyKey(`rename-sub:${sub.id}`);
    setError(null);

    const { error: updateError } = await supabase
      .from("expense_subcategories")
      .update({ name: trimmed })
      .eq("id", sub.id);

    if (updateError) {
      setError(updateError.message);
      setBusyKey(null);
      return;
    }

    setRenamingSubId(null);
    await refreshAll();
    await invalidateReferenceCache();
    setBusyKey(null);
  }

  async function toggleCategoryHidden(categoryName: string, hide: boolean) {
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }
    setBusyKey(`hide-cat:${categoryName}`);
    setError(null);
    const { error: updateError } = await supabase
      .from("expense_categories")
      .update({ is_active: !hide })
      .eq("name", categoryName);
    if (updateError) {
      setError(updateError.message);
    } else {
      await refreshAll();
      await invalidateReferenceCache();
    }
    setBusyKey(null);
  }

  async function deleteCategory(categoryName: string) {
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }
    setBusyKey(`delete-cat:${categoryName}`);
    setError(null);
    try {
      const { usageLines, linkedSubcategoryCount } =
        await fetchExpenseCategoryDeleteUsage(supabase, categoryName);
      const blockMessage = formatExpenseCategoryDeleteBlockedMessage(
        categoryName,
        usageLines,
        linkedSubcategoryCount,
      );
      if (blockMessage) {
        setError(blockMessage);
        setBusyKey(null);
        return;
      }
      if (
        !window.confirm(
          `Delete expense category "${categoryName}"? This cannot be undone.`,
        )
      ) {
        setBusyKey(null);
        return;
      }
      const { error: deleteError } = await supabase
        .from("expense_categories")
        .delete()
        .eq("name", categoryName);
      if (deleteError) {
        setError(deleteError.message);
      } else {
        await refreshAll();
        await invalidateReferenceCache();
      }
    } catch (usageError) {
      setError(
        usageError instanceof Error ? usageError.message : "Could not delete.",
      );
    }
    setBusyKey(null);
  }

  async function toggleSubcategoryHidden(sub: ExpenseSubcategoryLookup, hide: boolean) {
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }
    setBusyKey(`hide-sub:${sub.id}`);
    setError(null);
    const { error: updateError } = await supabase
      .from("expense_subcategories")
      .update({ is_active: !hide })
      .eq("id", sub.id);
    if (updateError) {
      setError(updateError.message);
    } else {
      await refreshAll();
      await invalidateReferenceCache();
    }
    setBusyKey(null);
  }

  async function deleteSubcategory(sub: ExpenseSubcategoryLookup) {
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }

    const isDuplicate = isUnlinkedDuplicateOfLinkedSubcategory(
      sub,
      subcategories,
    );
    if (isDuplicate) {
      const linkedCategories =
        unlinkedDuplicateCategoriesBySubId.get(sub.id) ?? [];
      const message = confirmRemoveUnlinkedDuplicateMessage(
        sub.name,
        linkedCategories,
      );
      if (!window.confirm(message)) {
        setError(message);
        return;
      }
      await executeAdminDeleteSubcategory(sub);
      return;
    }

    if (
      !window.confirm(
        `Delete sub-category "${sub.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    await executeAdminDeleteSubcategory(sub);
  }

  return (
    <div className="space-y-6">
      {isOffline && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {offlineWriteMessage}
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold text-[#0f2744]">
          Expense categories &amp; sub-categories
        </h2>
        <p className="mb-4 text-sm text-slate-600">{LOOKUP_SETTINGS_NOTE}</p>

        <form
          onSubmit={handleAddCategory}
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
          <p className="text-sm text-slate-500">No expense categories yet.</p>
        ) : (
          <ul className="space-y-4">
            {categories.map((category) => {
              const subs = subcategoriesByCategory.get(category.name) ?? [];
              const sortedSubs = [...subs].sort((left, right) =>
                left.name.localeCompare(right.name),
              );

              return (
                <li
                  key={category.name}
                  className="rounded-md border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {renamingCategory === category.name ? (
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={categoryRenameDraft}
                          onChange={(event) =>
                            setCategoryRenameDraft(event.target.value)
                          }
                          className={`${inputClassName} max-w-xs`}
                        />
                        <button
                          type="button"
                          onClick={() => saveCategoryRename(category.name)}
                          disabled={busyKey === `rename-cat:${category.name}`}
                          className="rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingCategory(null)}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-base font-semibold text-[#0f2744]">
                          {category.name}
                          {category.is_active === false
                            ? LOOKUP_HIDDEN_LABEL_SUFFIX
                            : ""}
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingCategory(category.name);
                              setCategoryRenameDraft(category.name);
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
                              busyKey === `delete-cat:${category.name}`
                            }
                            className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                          >
                            {busyKey === `delete-cat:${category.name}`
                              ? "Working…"
                              : "Delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void toggleCategoryHidden(
                                category.name,
                                category.is_active !== false,
                              )
                            }
                            disabled={
                              isOffline ||
                              busyKey === `hide-cat:${category.name}`
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
                  </div>

                  <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-100">
                    {sortedSubs.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-slate-500">
                        No sub-categories linked yet.
                      </li>
                    ) : (
                      sortedSubs.map((sub) => (
                        <li
                          key={sub.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                          {renamingSubId === sub.id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={subRenameDraft}
                                onChange={(event) =>
                                  setSubRenameDraft(event.target.value)
                                }
                                className={`${inputClassName} max-w-xs`}
                              />
                              <button
                                type="button"
                                onClick={() => saveSubRename(sub)}
                                disabled={busyKey === `rename-sub:${sub.id}`}
                                className="rounded-md bg-[#0f2744] px-2 py-1 text-xs font-medium text-white"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setRenamingSubId(null)}
                                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <span>
                                {sub.name}
                                {sub.is_active === false
                                  ? LOOKUP_HIDDEN_LABEL_SUFFIX
                                  : ""}
                              </span>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenamingSubId(sub.id);
                                    setSubRenameDraft(sub.name);
                                  }}
                                  disabled={isOffline}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteSubcategory(sub)}
                                  disabled={
                                    isOffline ||
                                    busyKey === `delete-sub:${sub.id}`
                                  }
                                  className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void toggleSubcategoryHidden(
                                      sub,
                                      sub.is_active !== false,
                                    )
                                  }
                                  disabled={
                                    isOffline ||
                                    busyKey === `hide-sub:${sub.id}`
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700"
                                >
                                  {sub.is_active === false
                                    ? "Show again"
                                    : "Hide from new entries"}
                                </button>
                              </div>
                            </>
                          )}
                        </li>
                      ))
                    )}
                  </ul>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={newSubNameByCategory[category.name] ?? ""}
                      onChange={(event) =>
                        setNewSubNameByCategory((prev) => ({
                          ...prev,
                          [category.name]: event.target.value,
                        }))
                      }
                      placeholder="New sub-category"
                      className={inputClassName}
                    />
                    <button
                      type="button"
                      onClick={() => handleAddSubcategory(category.name)}
                      disabled={
                        isOffline || busyKey === `add-sub:${category.name}`
                      }
                      className="shrink-0 rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
                    >
                      {busyKey === `add-sub:${category.name}`
                        ? "Adding…"
                        : "Add sub-category"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {unlinkedSubcategories.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-950">
          <h3 className="font-semibold">Unlinked sub-categories</h3>
          <p className="mt-1 text-amber-900/90">
            These lookup rows have no expense category (current workspace
            tenant only, via row-level security). Link them to a category below
            or hide from new entries if you still need them for history.
          </p>
          <ul className="mt-3 space-y-2">
            {unlinkedSubcategories.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200/80 bg-white/60 px-3 py-2"
              >
                <span className="min-w-[8rem] font-medium text-slate-800">
                  {row.name}
                  {formatUnlinkedDuplicateOfLabel(
                    unlinkedDuplicateCategoriesBySubId.get(row.id) ?? [],
                  )}
                  {row.is_active === false ? LOOKUP_HIDDEN_LABEL_SUFFIX : ""}
                </span>
                <select
                  value={linkCategoryBySubId[row.id] ?? ""}
                  onChange={(event) =>
                    setLinkCategoryBySubId((prev) => ({
                      ...prev,
                      [row.id]: event.target.value,
                    }))
                  }
                  className={`${inputClassName} max-w-xs`}
                  disabled={isOffline}
                >
                  <option value="">Select category</option>
                  {categoryOptionsForLink.map((category) => (
                    <option key={category.name} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleLinkUnlinkedSubcategory(row)}
                  disabled={
                    isOffline || busyKey === `link-sub:${row.id}`
                  }
                  className="rounded-md border border-[#0f2744] px-3 py-1.5 text-xs font-medium text-[#0f2744] hover:bg-slate-50 disabled:opacity-50"
                >
                  {busyKey === `link-sub:${row.id}` ? "Linking…" : "Link"}
                </button>
                {duplicateRemoveOffer?.subId === row.id ? (
                  <button
                    type="button"
                    onClick={() => void removeUnlinkedDuplicateSubcategory(row)}
                    disabled={
                      isOffline || busyKey === `delete-sub:${row.id}`
                    }
                    className="rounded-md border border-amber-600 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-200 disabled:opacity-50"
                  >
                    Remove
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void deleteSubcategory(row)}
                  disabled={
                    isOffline || busyKey === `delete-sub:${row.id}`
                  }
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void toggleSubcategoryHidden(row, row.is_active !== false)
                  }
                  disabled={isOffline || busyKey === `hide-sub:${row.id}`}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {row.is_active === false
                    ? "Show again"
                    : "Hide from new entries"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
