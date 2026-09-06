"use client";

export type BusinessUnitOption = {
  id: string;
  name: string;
};

export type BusinessUnitAccessFormState = {
  business_unit_ids: string[];
  default_business_unit_id: string | null;
};

type BusinessUnitAccessFieldsProps = {
  form: BusinessUnitAccessFormState;
  businessUnits: BusinessUnitOption[];
  onChange: (next: BusinessUnitAccessFormState) => void;
  idPrefix?: string;
  loading?: boolean;
};

export function emptyBusinessUnitAccessForm(): BusinessUnitAccessFormState {
  return {
    business_unit_ids: [],
    default_business_unit_id: null,
  };
}

export function businessUnitAccessFromApi(response: {
  unrestricted?: boolean;
  business_unit_ids?: string[];
  default_business_unit_id?: string | null;
}): BusinessUnitAccessFormState {
  if (response.unrestricted !== false) {
    return emptyBusinessUnitAccessForm();
  }

  const business_unit_ids = [...(response.business_unit_ids ?? [])];
  let default_business_unit_id = response.default_business_unit_id ?? null;

  if (business_unit_ids.length === 1) {
    default_business_unit_id = business_unit_ids[0]!;
  }

  return {
    business_unit_ids,
    default_business_unit_id,
  };
}

function resolveDefaultAfterToggle(
  selectedIds: string[],
  previousDefault: string | null,
): string | null {
  if (selectedIds.length === 0) {
    return null;
  }
  if (selectedIds.length === 1) {
    return selectedIds[0]!;
  }
  if (previousDefault && selectedIds.includes(previousDefault)) {
    return previousDefault;
  }
  return selectedIds[0] ?? null;
}

export default function BusinessUnitAccessFields({
  form,
  businessUnits,
  onChange,
  idPrefix = "bu-access",
  loading = false,
}: BusinessUnitAccessFieldsProps) {
  function toggleBusinessUnit(businessUnitId: string) {
    const selected = new Set(form.business_unit_ids);
    if (selected.has(businessUnitId)) {
      selected.delete(businessUnitId);
    } else {
      selected.add(businessUnitId);
    }

    const business_unit_ids = businessUnits
      .map((unit) => unit.id)
      .filter((id) => selected.has(id));

    onChange({
      business_unit_ids,
      default_business_unit_id: resolveDefaultAfterToggle(
        business_unit_ids,
        form.default_business_unit_id,
      ),
    });
  }

  const showDefaultPicker = form.business_unit_ids.length >= 2;

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">
        Business Unit Access
      </p>
      <p className="mb-2 text-xs text-slate-500">
        Leave all unchecked for unrestricted access (all business units). Check
        one or more to restrict this user to only those units.
      </p>
      {loading ? (
        <p className="text-sm text-slate-500">Loading business unit access…</p>
      ) : (
        <>
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-slate-300 bg-white p-3">
            {businessUnits.map((unit) => {
              const checked = form.business_unit_ids.includes(unit.id);

              return (
                <label
                  key={unit.id}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleBusinessUnit(unit.id)}
                    className="rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                  />
                  <span>{unit.name}</span>
                </label>
              );
            })}
          </div>

          {showDefaultPicker ? (
            <fieldset className="mt-3 space-y-2">
              <legend className="text-sm font-medium text-slate-700">
                Default business unit
              </legend>
              <p className="text-xs text-slate-500">
                Used when this user creates records without choosing a business
                unit explicitly.
              </p>
              {form.business_unit_ids.map((businessUnitId) => {
                const unit = businessUnits.find(
                  (entry) => entry.id === businessUnitId,
                );
                if (!unit) {
                  return null;
                }

                const inputId = `${idPrefix}-default-${businessUnitId}`;

                return (
                  <label
                    key={businessUnitId}
                    htmlFor={inputId}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      id={inputId}
                      type="radio"
                      name={`${idPrefix}-default-business-unit`}
                      checked={form.default_business_unit_id === businessUnitId}
                      onChange={() =>
                        onChange({
                          ...form,
                          default_business_unit_id: businessUnitId,
                        })
                      }
                      className="border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                    />
                    <span>{unit.name}</span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
        </>
      )}
    </div>
  );
}
