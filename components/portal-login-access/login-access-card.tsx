"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "@/components/password-input";
import { useAlert, useConfirm, useToast } from "@/components/feedback";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  SAME_PASSWORD_ALERT_TITLE,
  SAME_PASSWORD_USER_MESSAGE,
} from "@/utils/password-policy";
import {
  PORTAL_LOGIN_VERIFICATION_OPTIONS,
  type PortalLoginAuthStatus,
  type PortalLoginTargetPersona,
  type PortalLoginVerificationMethod,
  type SharedLoginLink,
} from "@/utils/portal-login-access/types";
import { parseApiErrorResponse } from "@/utils/parse-api-error";

type ApiBase = "admin" | "landlord-portal" | "tenant-admin";

export type LoginAccessTargetProps = {
  persona: PortalLoginTargetPersona;
  tenantId: string;
  lesseeId?: string;
  facilityManagerId?: string;
  authUid?: string;
  apiBase: ApiBase;
  /** When true, render as a card section. When false, only the manage actions UI (for modal host). */
  asCard?: boolean;
  title?: string;
  /** Preload status externally (optional). */
  autoLoad?: boolean;
};

type ModalKind =
  | "reset_link"
  | "temp_password"
  | "change_email"
  | "create_login"
  | null;

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function generateClientTempPassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) {
    out += alphabet[b % alphabet.length];
  }
  return `${out}Aa1!`.slice(0, Math.max(PASSWORD_MIN_LENGTH + 2, 16));
}

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

function targetBody(
  props: LoginAccessTargetProps,
): Record<string, string> {
  const body: Record<string, string> = {
    persona: props.persona,
    tenant_id: props.tenantId,
  };
  if (props.persona === "lessee" && props.lesseeId) {
    body.lessee_id = props.lesseeId;
  }
  if (props.persona === "facility_manager" && props.facilityManagerId) {
    body.facility_manager_id = props.facilityManagerId;
  }
  if (props.persona === "staff" && props.authUid) {
    body.auth_uid = props.authUid;
  }
  return body;
}

function statusQuery(props: LoginAccessTargetProps): string {
  const params = new URLSearchParams(targetBody(props));
  return params.toString();
}

export default function LoginAccessCard(props: LoginAccessTargetProps) {
  const {
    apiBase,
    asCard = true,
    title = "Login access",
    autoLoad = true,
  } = props;
  const router = useRouter();
  const { toast } = useToast();
  const { alertError } = useAlert();
  const confirm = useConfirm();
  const basePath = `/api/${apiBase}/portal-login-access`;

  const [status, setStatus] = useState<PortalLoginAuthStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [saving, setSaving] = useState(false);

  const [verificationMethod, setVerificationMethod] =
    useState<PortalLoginVerificationMethod | "">("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [alsoUpdateProfileEmail, setAlsoUpdateProfileEmail] = useState(false);
  const [generatedVisible, setGeneratedVisible] = useState(false);

  const verificationRef = useRef<HTMLSelectElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const passwordFieldId = `${formId}-password`;

  const queryKey = statusQuery(props);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError(null);
    try {
      const response = await fetch(`${basePath}/status?${queryKey}`);
      if (!response.ok) {
        setStatusError(
          await parseApiErrorResponse(response, "Failed to load login access"),
        );
        setStatus(null);
        return;
      }
      const payload = (await response.json()) as {
        status?: PortalLoginAuthStatus;
      };
      setStatus(payload.status ?? null);
    } finally {
      setLoadingStatus(false);
    }
  }, [basePath, queryKey]);

  useEffect(() => {
    if (autoLoad) {
      void loadStatus();
    }
  }, [autoLoad, loadStatus]);

  function closeModal() {
    setModal(null);
    setVerificationMethod("");
    setReason("");
    setPassword("");
    setEmail("");
    setAlsoUpdateProfileEmail(false);
    setGeneratedVisible(false);
    setSaving(false);
  }

  function openModal(kind: ModalKind) {
    setVerificationMethod("");
    setReason("");
    setPassword("");
    setAlsoUpdateProfileEmail(false);
    setGeneratedVisible(false);
    setEmail(
      kind === "change_email" || kind === "create_login"
        ? (status?.loginEmail ?? status?.profileEmail ?? "")
        : "",
    );
    setModal(kind);
  }

  async function confirmSharedIfNeeded(
    sharedLinks: SharedLoginLink[] | undefined,
  ): Promise<boolean> {
    if (!sharedLinks || sharedLinks.length === 0) {
      return true;
    }
    if (apiBase === "landlord-portal" || apiBase === "tenant-admin") {
      return false;
    }
    const summary = sharedLinks.map((link) => link.label).join("\n• ");
    return confirm({
      title: "This login is shared",
      message: `This login is also attached to:\n• ${summary}\n\nContinue anyway?`,
      confirmLabel: "Continue",
    });
  }

  async function postAction(
    endpoint: string,
    body: Record<string, unknown>,
    confirmSharedLogin: boolean,
  ): Promise<{
    ok: boolean;
    notificationFailed?: boolean;
    message?: string;
  }> {
    const response = await fetch(`${basePath}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...targetBody(props),
        ...body,
        confirm_shared_login: confirmSharedLogin,
      }),
    });

    if (response.status === 409) {
      const payload = (await response.json().catch(() => null)) as {
        code?: string;
        error?: string;
        shared_links?: SharedLoginLink[];
      } | null;

      if (payload?.code === "shared_login_refused") {
        void alertError(
          payload.error ??
            "This login is also used for another account on the platform. Please contact Davors support to reset it.",
          { title: "Could not complete action" },
        );
        return { ok: false };
      }

      if (payload?.code === "shared_login_requires_confirmation") {
        const accepted = await confirmSharedIfNeeded(payload.shared_links);
        if (!accepted) {
          return { ok: false };
        }
        return postAction(endpoint, body, true);
      }
    }

    if (!response.ok) {
      const message = await parseApiErrorResponse(
        response,
        "Could not complete action",
      );
      void alertError(message, {
        title:
          message === SAME_PASSWORD_USER_MESSAGE
            ? SAME_PASSWORD_ALERT_TITLE
            : "Could not complete action",
      });
      return { ok: false };
    }

    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      notification_failed?: boolean;
    } | null;

    return {
      ok: true,
      message: payload?.message,
      notificationFailed: payload?.notification_failed === true,
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!modal || saving) return;

    if (!verificationMethod) {
      verificationRef.current?.focus();
      return;
    }
    if (!reason.trim()) {
      reasonRef.current?.focus();
      return;
    }

    if (
      (modal === "temp_password" || modal === "create_login") &&
      password.length < PASSWORD_MIN_LENGTH
    ) {
      document.getElementById(passwordFieldId)?.focus();
      return;
    }
    if (
      (modal === "change_email" || modal === "create_login") &&
      !email.trim()
    ) {
      emailRef.current?.focus();
      return;
    }

    setSaving(true);

    let endpoint = "";
    let body: Record<string, unknown> = {
      verification_method: verificationMethod,
      reason: reason.trim(),
    };

    if (modal === "reset_link") {
      endpoint = "reset-link";
    } else if (modal === "temp_password") {
      endpoint = "set-temp-password";
      body = { ...body, password };
    } else if (modal === "change_email") {
      endpoint = "change-email";
      body = {
        ...body,
        email: email.trim(),
        // Staff account email must stay in sync with Auth; other personas
        // can optionally update their profile email via the checkbox.
        also_update_profile_email:
          props.persona === "staff" ? true : alsoUpdateProfileEmail,
      };
    } else {
      endpoint = "create-login";
      body = { ...body, email: email.trim(), password };
    }

    const result = await postAction(endpoint, body, false);
    setSaving(false);
    if (!result.ok) {
      return;
    }

    closeModal();
    toast(result.message ?? "Done.");
    if (result.notificationFailed) {
      void alertError(
        "The login change was saved, but the notification email could not be sent.",
        { title: "Notification not sent" },
      );
    }
    await loadStatus();
    router.refresh();
  }

  const authExists = status?.authUserExists === true;
  const showCreate = status != null && !authExists;

  const body = (
    <>
      {loadingStatus ? (
        <p className="text-sm text-slate-500">Loading login status…</p>
      ) : null}
      {statusError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {statusError}
        </p>
      ) : null}
      {status && !loadingStatus ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Login email
              </dt>
              <dd className="mt-1 text-slate-900">
                {status.loginEmail ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Auth account
              </dt>
              <dd className="mt-1 text-slate-900">
                {status.authUserExists ? "Exists" : "None"}
                {status.isSuspended ? " · Suspended" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Last sign-in
              </dt>
              <dd className="mt-1 text-slate-900">
                {formatDateTime(status.lastSignInAt)}
              </dd>
            </div>
          </dl>
          {status.isSuspended ? (
            <p className="mt-3 text-sm text-amber-800">
              This Auth account is currently suspended (banned). Login access
              actions may still update credentials, but sign-in remains blocked
              until the ban is lifted elsewhere.
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {authExists ? (
              <>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => openModal("reset_link")}
                >
                  Send reset link
                </button>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => openModal("temp_password")}
                >
                  Set temporary password
                </button>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => openModal("change_email")}
                >
                  Change login email
                </button>
              </>
            ) : null}
            {showCreate ? (
              <button
                type="button"
                className={primaryButtonClassName}
                onClick={() => openModal("create_login")}
              >
                Create login
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {modal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${formId}-title`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <h3
              id={`${formId}-title`}
              className="text-lg font-semibold text-[#0f2744]"
            >
              {modal === "reset_link"
                ? "Send reset link"
                : modal === "temp_password"
                  ? "Set temporary password"
                  : modal === "change_email"
                    ? "Change login email"
                    : "Create login"}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {status?.displayName}
              {status?.loginEmail || status?.profileEmail ? (
                <>
                  <span className="text-slate-400"> · </span>
                  {status.loginEmail ?? status.profileEmail}
                </>
              ) : null}
            </p>

            <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor={`${formId}-verification`}
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  How was the user verified?
                </label>
                <select
                  id={`${formId}-verification`}
                  ref={verificationRef}
                  required
                  value={verificationMethod}
                  onChange={(e) =>
                    setVerificationMethod(
                      e.target.value as PortalLoginVerificationMethod | "",
                    )
                  }
                  className={inputClassName}
                >
                  <option value="" disabled>
                    Select verification method
                  </option>
                  {PORTAL_LOGIN_VERIFICATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor={`${formId}-reason`}
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Reason
                </label>
                <input
                  id={`${formId}-reason`}
                  ref={reasonRef}
                  type="text"
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={inputClassName}
                />
              </div>

              {modal === "change_email" || modal === "create_login" ? (
                <div>
                  <label
                    htmlFor={`${formId}-email`}
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    {modal === "create_login" ? "Login email" : "New login email"}
                  </label>
                  <input
                    id={`${formId}-email`}
                    ref={emailRef}
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClassName}
                  />
                  {modal === "change_email" && props.persona !== "staff" ? (
                    <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={alsoUpdateProfileEmail}
                        onChange={(e) =>
                          setAlsoUpdateProfileEmail(e.target.checked)
                        }
                        className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                      />
                      Also update profile email
                    </label>
                  ) : null}
                  {modal === "change_email" && props.persona === "staff" ? (
                    <p className="mt-2 text-xs text-slate-500">
                      The User Accounts email will be updated to match.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {modal === "temp_password" || modal === "create_login" ? (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label
                      htmlFor={`${formId}-password`}
                      className="block text-sm font-medium text-slate-700"
                    >
                      Temporary password
                    </label>
                    <button
                      type="button"
                      className="text-xs font-medium text-[#0f2744] hover:underline"
                      onClick={() => {
                        const next = generateClientTempPassword();
                        setPassword(next);
                        setGeneratedVisible(true);
                      }}
                    >
                      Generate
                    </button>
                  </div>
                  <PasswordInput
                    id={passwordFieldId}
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setGeneratedVisible(false);
                    }}
                    className={inputClassName}
                    autoComplete="new-password"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    {PASSWORD_POLICY_HINT}
                  </p>
                  {generatedVisible && password ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <code className="break-all text-sm text-slate-900">
                        {password}
                      </code>
                      <button
                        type="button"
                        className={secondaryButtonClassName}
                        onClick={() => {
                          void navigator.clipboard.writeText(password);
                          toast("Password copied.");
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {modal === "reset_link" ? (
                <p className="text-sm text-slate-600">
                  Sends the standard password recovery email to the current
                  login address.
                </p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className={secondaryButtonClassName}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={primaryButtonClassName}
                >
                  {saving ? "Saving…" : "Confirm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );

  if (!asCard) {
    return <div className="space-y-3">{body}</div>;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-base font-semibold text-[#0f2744]">{title}</h3>
      {body}
    </section>
  );
}
