"use client";

import { useEffect, useMemo, useState } from "react";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import PaymentAccountFormFields, {
  paymentAccountInputClassName,
} from "@/components/payment-account-form-fields";
import { TenantLogosMediaImage } from "@/components/tenant-logos-media";
import {
  emptyPaymentAccountForm,
  formatPaymentAccountSummary,
  paymentAccountContactWarning,
  paymentAccountToForm,
  validatePaymentAccountInput,
  type PaymentAccountRow,
} from "@/utils/payment-accounts-types";
import type { BusinessUnitRow } from "@/utils/business-units-types";

type BusinessUnitFormState = {
  name: string;
  invoice_address: string;
  business_email: string;
  phone: string;
  phone_alt: string;
  website: string;
  business_registration_number: string;
  gra_tin: string;
  is_active: boolean;
};

type BusinessUnitFormDrawerProps = {
  open: boolean;
  mode: "new" | "edit";
  tenantId: string;
  businessUnits: BusinessUnitRow[];
  form: BusinessUnitFormState;
  onFormChange: React.Dispatch<React.SetStateAction<BusinessUnitFormState>>;
  editingUnit: BusinessUnitRow | null;
  pendingLogoFile: File | null;
  onPendingLogoFileChange: (file: File | null) => void;
  paymentAccounts: PaymentAccountRow[];
  onPaymentAccountsChange: (accounts: PaymentAccountRow[]) => void;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function PaymentAccountDetailList({ account }: { account: PaymentAccountRow }) {
  const items = [
    account.bank_name ? { label: "Bank", value: account.bank_name } : null,
    account.account_name
      ? { label: "Account name", value: account.account_name }
      : null,
    account.bank_account_number
      ? { label: "Account number", value: account.bank_account_number }
      : null,
    account.momo_merchant_name
      ? { label: "MoMo merchant", value: account.momo_merchant_name }
      : null,
    account.momo_provider
      ? { label: "MoMo provider", value: account.momo_provider }
      : null,
    account.momo_number
      ? { label: "MoMo number", value: account.momo_number }
      : null,
    account.momo_merchant_id
      ? { label: "Merchant ID", value: account.momo_merchant_id }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (items.length === 0) {
    return <p className="text-xs text-slate-500">No payment details yet.</p>;
  }

  return (
    <dl className="space-y-0.5 text-xs text-slate-700">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="inline font-medium text-slate-800">{item.label}: </dt>
          <dd className="inline">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function BusinessUnitFormDrawer({
  open,
  mode,
  tenantId,
  businessUnits,
  form,
  onFormChange,
  editingUnit,
  pendingLogoFile,
  onPendingLogoFileChange,
  paymentAccounts,
  onPaymentAccountsChange,
  saving,
  onClose,
  onSubmit,
}: BusinessUnitFormDrawerProps) {
  const [paymentFormOpen, setPaymentFormOpen] = useState<"new" | string | null>(
    null,
  );
  const [paymentForm, setPaymentForm] = useState(emptyPaymentAccountForm);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentWarning, setPaymentWarning] = useState<string | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkPickerAccountId, setLinkPickerAccountId] = useState("");
  const [linkConfirmAccount, setLinkConfirmAccount] =
    useState<PaymentAccountRow | null>(null);

  const activeBusinessUnits = useMemo(
    () => businessUnits.filter((unit) => unit.is_active),
    [businessUnits],
  );

  const linkedAccounts = useMemo(() => {
    if (!editingUnit) {
      return [];
    }
    return paymentAccounts.filter((account) =>
      account.business_unit_ids.includes(editingUnit.id),
    );
  }, [paymentAccounts, editingUnit]);

  const sharedAccounts = useMemo(
    () =>
      paymentAccounts.filter((account) => account.business_unit_ids.length === 0),
    [paymentAccounts],
  );

  const linkableAccounts = useMemo(() => {
    if (!editingUnit) {
      return [];
    }
    return paymentAccounts.filter(
      (account) => !account.business_unit_ids.includes(editingUnit.id),
    );
  }, [paymentAccounts, editingUnit]);

  useEffect(() => {
    if (!open) {
      setPaymentFormOpen(null);
      setPaymentForm(emptyPaymentAccountForm());
      setPaymentError(null);
      setPaymentWarning(null);
      setLinkPickerOpen(false);
      setLinkPickerAccountId("");
      setLinkConfirmAccount(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !paymentFormOpen) {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, paymentFormOpen]);

  async function savePaymentAccount() {
    if (!editingUnit) {
      return;
    }

    setPaymentSaving(true);
    setPaymentError(null);
    setPaymentWarning(null);

    const validationError = validatePaymentAccountInput(paymentForm);
    if (validationError) {
      setPaymentError(validationError);
      setPaymentSaving(false);
      return;
    }

    setPaymentWarning(paymentAccountContactWarning(paymentForm));

    const isEditing = paymentFormOpen !== null && paymentFormOpen !== "new";

    const response = await fetch("/api/payment-accounts", {
      method: isEditing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isEditing
          ? {
              id: paymentFormOpen,
              ...paymentForm,
              business_unit_ids:
                paymentForm.availability === "selected"
                  ? paymentForm.business_unit_ids
                  : [],
            }
          : {
              ...paymentForm,
              availability: "selected" as const,
              business_unit_ids: [editingUnit.id],
            },
      ),
    });

    const payload = (await response.json().catch(() => null)) as
      | { payment_account?: PaymentAccountRow; error?: string }
      | null;

    if (!response.ok || !payload?.payment_account) {
      setPaymentError(payload?.error ?? "Unable to save payment account.");
      setPaymentSaving(false);
      return;
    }

    onPaymentAccountsChange(
      paymentAccounts.some((a) => a.id === payload.payment_account!.id)
        ? paymentAccounts.map((a) =>
            a.id === payload.payment_account!.id ? payload.payment_account! : a,
          )
        : [...paymentAccounts, payload.payment_account!].sort((a, b) =>
            a.account_name.localeCompare(b.account_name),
          ),
    );
    setPaymentFormOpen(null);
    setPaymentForm(emptyPaymentAccountForm());
    setPaymentSaving(false);
  }

  async function performLinkPaymentAccount(account: PaymentAccountRow) {
    if (!editingUnit) {
      return;
    }

    setPaymentSaving(true);
    setPaymentError(null);
    setLinkConfirmAccount(null);
    setLinkPickerOpen(false);

    const response = await fetch("/api/payment-accounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: account.id,
        link_business_unit_id: editingUnit.id,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { payment_account?: PaymentAccountRow; error?: string }
      | null;

    if (!response.ok || !payload?.payment_account) {
      setPaymentError(payload?.error ?? "Unable to link payment account.");
      setPaymentSaving(false);
      return;
    }

    onPaymentAccountsChange(
      paymentAccounts.map((a) =>
        a.id === payload.payment_account!.id ? payload.payment_account! : a,
      ),
    );
    setLinkPickerAccountId("");
    setPaymentSaving(false);
  }

  function requestLinkPaymentAccount(account: PaymentAccountRow) {
    if (account.business_unit_ids.length === 0) {
      setLinkConfirmAccount(account);
      return;
    }
    void performLinkPaymentAccount(account);
  }

  async function unlinkPaymentAccount(account: PaymentAccountRow) {
    if (!editingUnit) {
      return;
    }

    const isLastLink =
      account.business_unit_ids.length === 1 &&
      account.business_unit_ids.includes(editingUnit.id);
    const confirmed = window.confirm(
      isLastLink
        ? `Unlink "${account.account_name}" from this business unit? This account will become available to all business units.`
        : `Unlink "${account.account_name}" from this business unit?`,
    );
    if (!confirmed) {
      return;
    }

    setPaymentSaving(true);
    setPaymentError(null);

    const response = await fetch("/api/payment-accounts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: account.id,
        unlink_business_unit_id: editingUnit.id,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { payment_account?: PaymentAccountRow; error?: string }
      | null;

    if (!response.ok || !payload?.payment_account) {
      setPaymentError(payload?.error ?? "Unable to unlink payment account.");
      setPaymentSaving(false);
      return;
    }

    onPaymentAccountsChange(
      paymentAccounts.map((a) =>
        a.id === payload.payment_account!.id ? payload.payment_account! : a,
      ),
    );
    setPaymentSaving(false);
  }

  function openAddPaymentAccount() {
    setPaymentForm({
      ...emptyPaymentAccountForm(),
      availability: "selected",
      business_unit_ids: editingUnit ? [editingUnit.id] : [],
    });
    setPaymentFormOpen("new");
    setLinkPickerOpen(false);
    setLinkConfirmAccount(null);
    setPaymentError(null);
    setPaymentWarning(null);
  }

  function openLinkExistingPicker() {
    setLinkPickerOpen(true);
    setLinkConfirmAccount(null);
    setPaymentFormOpen(null);
    setLinkPickerAccountId(linkableAccounts[0]?.id ?? "");
    setPaymentError(null);
  }

  function openEditPaymentAccount(account: PaymentAccountRow) {
    setPaymentForm(paymentAccountToForm(account));
    setPaymentFormOpen(account.id);
    setPaymentError(null);
    setPaymentWarning(null);
  }

  if (!open) {
    return null;
  }

  const title =
    mode === "new" ? "New Business Unit" : "Edit Business Unit";

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close business unit form"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-unit-form-drawer-title"
        className="relative flex h-full w-full max-w-none flex-col bg-white shadow-2xl sm:max-w-md md:max-w-xl lg:max-w-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id="business-unit-form-drawer-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              {title}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Name is required. Other fields are optional.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            disabled={saving}
          >
            Close
          </button>
        </header>

        <form
          id="business-unit-drawer-form"
          onSubmit={onSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="space-y-6">
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-[#0f2744]">
                  Identity
                </h3>
                <div>
                  <label
                    htmlFor="business-unit-name"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="business-unit-name"
                    type="text"
                    value={form.name}
                    onChange={(event) =>
                      onFormChange((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className={paymentAccountInputClassName}
                    required
                    disabled={saving}
                  />
                </div>

                <div>
                  <p className="mb-1 text-sm font-medium text-slate-700">Logo</p>
                  {editingUnit?.logo_url && !pendingLogoFile ? (
                    <TenantLogosMediaImage
                      reference={editingUnit.logo_url}
                      tenantId={tenantId}
                      alt={`${editingUnit.name} logo preview`}
                      className="mb-3 h-16 w-16 rounded-md border border-slate-200 object-contain bg-white"
                    />
                  ) : null}
                  {pendingLogoFile ? (
                    <p className="mb-2 text-sm text-slate-600">
                      Selected: {pendingLogoFile.name}
                    </p>
                  ) : null}
                  <ImageFileUploadButton
                    files={pendingLogoFile ? [pendingLogoFile] : []}
                    multiple={false}
                    disabled={saving}
                    addLabel="Upload logo"
                    changeLabel="Change logo"
                    resetInputAfterSelect
                    onChange={(next) => {
                      onPendingLogoFileChange(next[0] ?? null);
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="business-unit-invoice-address"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Invoice address
                  </label>
                  <textarea
                    id="business-unit-invoice-address"
                    value={form.invoice_address}
                    onChange={(event) =>
                      onFormChange((current) => ({
                        ...current,
                        invoice_address: event.target.value,
                      }))
                    }
                    rows={4}
                    className={paymentAccountInputClassName}
                    disabled={saving}
                  />
                </div>

                <div>
                  <label
                    htmlFor="business-unit-business-email"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Business email
                  </label>
                  <input
                    id="business-unit-business-email"
                    type="email"
                    value={form.business_email}
                    onChange={(event) =>
                      onFormChange((current) => ({
                        ...current,
                        business_email: event.target.value,
                      }))
                    }
                    className={paymentAccountInputClassName}
                    disabled={saving}
                    placeholder="billing@example.com"
                    autoComplete="email"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) =>
                      onFormChange((current) => ({
                        ...current,
                        is_active: event.target.checked,
                      }))
                    }
                    disabled={saving}
                    className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                  />
                  Active
                </label>
              </section>

              <section className="space-y-4 border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-[#0f2744]">
                  Contact & registration
                </h3>
                <div>
                  <label
                    htmlFor="business-unit-phone"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Business phone
                  </label>
                  <p className="mb-1 text-xs text-slate-500">
                    Main contact number shown on invoices — not your MoMo number
                  </p>
                  <input
                    id="business-unit-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(event) =>
                      onFormChange((current) => ({
                        ...current,
                        phone: event.target.value,
                      }))
                    }
                    className={paymentAccountInputClassName}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label
                    htmlFor="business-unit-phone-alt"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Alternative phone
                  </label>
                  <input
                    id="business-unit-phone-alt"
                    type="tel"
                    value={form.phone_alt}
                    onChange={(event) =>
                      onFormChange((current) => ({
                        ...current,
                        phone_alt: event.target.value,
                      }))
                    }
                    className={paymentAccountInputClassName}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label
                    htmlFor="business-unit-website"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Website
                  </label>
                  <input
                    id="business-unit-website"
                    type="text"
                    value={form.website}
                    onChange={(event) =>
                      onFormChange((current) => ({
                        ...current,
                        website: event.target.value,
                      }))
                    }
                    className={paymentAccountInputClassName}
                    disabled={saving}
                    placeholder="example.com"
                  />
                </div>
                <div>
                  <label
                    htmlFor="business-unit-reg-no"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Business registration number
                  </label>
                  <input
                    id="business-unit-reg-no"
                    type="text"
                    value={form.business_registration_number}
                    onChange={(event) =>
                      onFormChange((current) => ({
                        ...current,
                        business_registration_number: event.target.value,
                      }))
                    }
                    className={paymentAccountInputClassName}
                    disabled={saving}
                  />
                </div>
                <div>
                  <label
                    htmlFor="business-unit-gra-tin"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    TIN (GRA)
                  </label>
                  <input
                    id="business-unit-gra-tin"
                    type="text"
                    value={form.gra_tin}
                    onChange={(event) =>
                      onFormChange((current) => ({
                        ...current,
                        gra_tin: event.target.value,
                      }))
                    }
                    className={paymentAccountInputClassName}
                    disabled={saving}
                    placeholder="GRA taxpayer identification number"
                  />
                </div>
              </section>

              {mode === "edit" && editingUnit ? (
                <section className="space-y-4 border-t border-slate-200 pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-[#0f2744]">
                        Payment accounts (bank & MoMo)
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Link bank and MoMo profiles to this business unit. Shared
                        accounts are available to every unit.
                      </p>
                    </div>
                    {!paymentFormOpen && !linkPickerOpen ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={openLinkExistingPicker}
                          className={secondaryButtonClassName}
                          disabled={
                            saving || paymentSaving || linkableAccounts.length === 0
                          }
                        >
                          Link existing account
                        </button>
                        <button
                          type="button"
                          onClick={openAddPaymentAccount}
                          className={secondaryButtonClassName}
                          disabled={saving || paymentSaving}
                        >
                          Add new account
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {paymentError ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {paymentError}
                    </p>
                  ) : null}
                  {paymentWarning ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {paymentWarning}
                    </p>
                  ) : null}

                  {linkConfirmAccount ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm text-amber-950">
                        &ldquo;{linkConfirmAccount.account_name}&rdquo; is
                        available to all business units. Linking it here will
                        restrict it to this unit only unless you also select
                        other units under Available to.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void performLinkPaymentAccount(linkConfirmAccount)
                          }
                          className={primaryButtonClassName}
                          disabled={paymentSaving}
                        >
                          Link to this unit only
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            openEditPaymentAccount(linkConfirmAccount);
                            setLinkConfirmAccount(null);
                          }}
                          className={secondaryButtonClassName}
                          disabled={paymentSaving}
                        >
                          Open availability settings
                        </button>
                        <button
                          type="button"
                          onClick={() => setLinkConfirmAccount(null)}
                          className={secondaryButtonClassName}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {linkPickerOpen && !linkConfirmAccount ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                      <h4 className="mb-3 text-sm font-medium text-slate-800">
                        Link existing account
                      </h4>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Payment account
                      </label>
                      <select
                        value={linkPickerAccountId}
                        onChange={(event) =>
                          setLinkPickerAccountId(event.target.value)
                        }
                        className={paymentAccountInputClassName}
                        disabled={paymentSaving}
                      >
                        {linkableAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.account_name}
                            {formatPaymentAccountSummary(account)
                              ? ` — ${formatPaymentAccountSummary(account)}`
                              : ""}
                          </option>
                        ))}
                      </select>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const account = linkableAccounts.find(
                              (a) => a.id === linkPickerAccountId,
                            );
                            if (account) {
                              requestLinkPaymentAccount(account);
                            }
                          }}
                          className={primaryButtonClassName}
                          disabled={!linkPickerAccountId || paymentSaving}
                        >
                          Link account
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setLinkPickerOpen(false);
                            setLinkPickerAccountId("");
                          }}
                          className={secondaryButtonClassName}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {paymentFormOpen ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                      <h4 className="mb-3 text-sm font-medium text-slate-800">
                        {paymentFormOpen === "new"
                          ? "New payment account"
                          : "Edit payment account"}
                      </h4>
                      <div className="grid gap-4 md:grid-cols-2">
                        <PaymentAccountFormFields
                          form={paymentForm}
                          setForm={setPaymentForm}
                          businessUnits={activeBusinessUnits}
                          showAvailabilityFields
                          lockedBusinessUnitId={
                            paymentFormOpen === "new" ? editingUnit.id : null
                          }
                          disabled={paymentSaving}
                          idPrefix="bu-payment"
                        />
                        <div className="flex flex-wrap gap-2 md:col-span-2">
                          <button
                            type="button"
                            onClick={() => void savePaymentAccount()}
                            disabled={paymentSaving}
                            className={primaryButtonClassName}
                          >
                            {paymentSaving ? "Saving…" : "Save account"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentFormOpen(null);
                              setPaymentForm(emptyPaymentAccountForm());
                            }}
                            className={secondaryButtonClassName}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Linked to this unit
                    </p>
                    {linkedAccounts.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        No payment accounts linked yet.
                      </p>
                    ) : (
                      linkedAccounts.map((account) => (
                        <article
                          key={account.id}
                          className="rounded-md border border-slate-200 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-[#0f2744]">
                                {account.account_name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {formatPaymentAccountSummary(account) ||
                                  "No details"}
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <button
                                type="button"
                                onClick={() => openEditPaymentAccount(account)}
                                className={secondaryButtonClassName}
                                disabled={paymentSaving || saving}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => unlinkPaymentAccount(account)}
                                className={secondaryButtonClassName}
                                disabled={paymentSaving || saving}
                              >
                                Unlink
                              </button>
                            </div>
                          </div>
                          <div className="mt-2">
                            <PaymentAccountDetailList account={account} />
                          </div>
                        </article>
                      ))
                    )}
                  </div>

                  {sharedAccounts.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Available to all businesses
                      </p>
                      {sharedAccounts.map((account) => (
                        <article
                          key={account.id}
                          className="rounded-md border border-dashed border-slate-200 bg-slate-50/80 p-3"
                        >
                          <p className="text-sm font-medium text-slate-800">
                            {account.account_name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatPaymentAccountSummary(account) ||
                              "Read-only — managed under Payment Accounts"}
                          </p>
                          <div className="mt-2">
                            <PaymentAccountDetailList account={account} />
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </div>

          <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-4 py-4 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className={secondaryButtonClassName}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={primaryButtonClassName}
              disabled={saving}
            >
              {saving
                ? "Saving…"
                : mode === "new"
                  ? "Create Business Unit"
                  : "Save Changes"}
            </button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
