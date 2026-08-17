"use client";

import { useState } from "react";
import PasswordInput from "@/components/password-input";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
} from "@/utils/password-policy";
import { updateOwnPassword } from "@/lib/security/update-password-action";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
  portalSuccessBannerClassName,
} from "../portal-ui";

export default function LandlordPortalAccountChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const result = await updateOwnPassword(password, confirmPassword);

    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setSuccess("Password updated successfully.");
    setLoading(false);
  }

  return (
    <section className={portalSectionClassName}>
      <h2 className={portalSectionTitleClassName}>Change password</h2>
      <p className="mt-1 text-sm text-slate-600">{PASSWORD_POLICY_HINT}</p>

      <form onSubmit={handleSubmit} className="mt-4 grid max-w-md gap-4">
        {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
        {success ? (
          <div className={portalSuccessBannerClassName}>{success}</div>
        ) : null}

        <div>
          <label htmlFor="landlord-new-password" className={portalLabelClassName}>
            New password
          </label>
          <PasswordInput
            id="landlord-new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={portalInputClassName}
          />
        </div>
        <div>
          <label htmlFor="landlord-confirm-password" className={portalLabelClassName}>
            Confirm new password
          </label>
          <PasswordInput
            id="landlord-confirm-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={portalInputClassName}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className={portalPrimaryButtonClassName}
        >
          {loading ? "Updating…" : "Update password"}
        </button>
      </form>
    </section>
  );
}
