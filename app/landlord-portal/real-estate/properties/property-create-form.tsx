"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PROPERTY_TYPE_OPTIONS,
  type PropertyType,
} from "@/app/dashboard/real-estate/properties-utils";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

const emptyForm = {
  name: "",
  property_type: "" as PropertyType | "",
  address_line1: "",
  address_line2: "",
  city: "",
  region: "",
};

export default function LandlordPortalPropertyCreateForm() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/landlord-portal/properties/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        property_type: form.property_type,
        address_line1: form.address_line1,
        address_line2: form.address_line2,
        city: form.city,
        region: form.region,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      property_id?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to create property.");
      setLoading(false);
      return;
    }

    setForm(emptyForm);
    setShowForm(false);
    setSuccess("Property created.");
    setLoading(false);
    router.refresh();

    if (payload?.property_id) {
      router.push(
        `/landlord-portal/real-estate/properties/${payload.property_id}`,
      );
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setSuccess(null);
            setForm(emptyForm);
            setShowForm((current) => !current);
          }}
          className={portalPrimaryButtonClassName}
        >
          {showForm ? "Cancel" : "Add Property"}
        </button>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      {showForm ? (
        <form
          onSubmit={handleCreate}
          className={`${portalSectionClassName} space-y-4`}
        >
          <h2 className={portalSectionTitleClassName}>New Property</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className={portalLabelClassName}>Name</label>
              <input
                required
                type="text"
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                className={portalInputClassName}
              />
            </div>
            <div>
              <label className={portalLabelClassName}>Property Type</label>
              <select
                required
                value={form.property_type}
                onChange={(event) =>
                  updateField("property_type", event.target.value)
                }
                className={portalInputClassName}
              >
                <option value="">Select type</option>
                {PROPERTY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={portalLabelClassName}>Address Line 1</label>
              <input
                required
                type="text"
                value={form.address_line1}
                onChange={(event) =>
                  updateField("address_line1", event.target.value)
                }
                className={portalInputClassName}
              />
            </div>
            <div>
              <label className={portalLabelClassName}>Address Line 2</label>
              <input
                required
                type="text"
                value={form.address_line2}
                onChange={(event) =>
                  updateField("address_line2", event.target.value)
                }
                className={portalInputClassName}
              />
            </div>
            <div>
              <label className={portalLabelClassName}>City</label>
              <input
                required
                type="text"
                value={form.city}
                onChange={(event) => updateField("city", event.target.value)}
                className={portalInputClassName}
              />
            </div>
            <div>
              <label className={portalLabelClassName}>Region</label>
              <input
                required
                type="text"
                value={form.region}
                onChange={(event) => updateField("region", event.target.value)}
                className={portalInputClassName}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className={portalPrimaryButtonClassName}
            >
              {loading ? "Saving…" : "Save Property"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setForm(emptyForm);
              }}
              className={portalSecondaryButtonClassName}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
