"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import type { ProjectEntry } from "./projects-utils";

type ProjectsProps = {
  initialProjects: ProjectEntry[];
  fetchError: string | null;
};

const emptyForm = {
  project_code: "",
  project_name: "",
};

export default function Projects({
  initialProjects,
  fetchError,
}: ProjectsProps) {
  const supabase = createClient();
  const [projects, setProjects] = useState(initialProjects);
  const [showForm, setShowForm] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  async function refreshProjects() {
    const { data, error: refreshError } = await supabase
      .from("projects")
      .select("project_code, project_name")
      .order("project_name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setProjects((data as ProjectEntry[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingCode(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function closeForm() {
    setEditingCode(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(project: ProjectEntry) {
    setEditingCode(project.project_code);
    setForm({
      project_code: project.project_code,
      project_name: project.project_name,
    });
    setShowForm(true);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleDelete(projectCode: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingCode(projectCode);
    setError(null);

    const { error: deleteError } = await supabase
      .from("projects")
      .delete()
      .eq("project_code", projectCode);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingCode(null);
      return;
    }

    if (editingCode === projectCode) {
      closeForm();
    }

    await refreshProjects();
    setDeletingCode(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      project_code: form.project_code.trim(),
      project_name: form.project_name.trim(),
    };

    const { error: saveError } = editingCode
      ? await supabase
          .from("projects")
          .update({ project_name: payload.project_name })
          .eq("project_code", editingCode)
      : await supabase.from("projects").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshProjects();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Manage contract and project assignments used on employee records.
        </p>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Project"}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingCode ? "Edit Project" : "New Project"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Project Code
                </label>
                <input
                  type="text"
                  required
                  readOnly={Boolean(editingCode)}
                  value={form.project_code}
                  onChange={(e) => updateField("project_code", e.target.value)}
                  className={`${inputClassName}${editingCode ? " bg-slate-50 text-slate-600" : ""}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  value={form.project_name}
                  onChange={(e) => updateField("project_name", e.target.value)}
                  className={inputClassName}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Saving…"
                  : editingCode
                    ? "Save Changes"
                    : "Add Project"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Project Code</th>
              <th className={scrollableTableThClassName}>Project Name</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {projects.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No projects configured yet.
                </td>
              </tr>
            ) : (
              projects.map((project, index) => (
                <tr key={project.project_code} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{project.project_code}</td>
                  <td className="px-4 py-3">{project.project_name}</td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(project)}
                    onDelete={() => handleDelete(project.project_code)}
                    deleting={deletingCode === project.project_code}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
