"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import PasswordInput from "@/components/password-input";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

/**
 * Landlord portal password change — same supabase.auth.updateUser pattern as
 * staff My Account, with portal signup min length (8).
 */
export default function LandlordPortalChangePasswordForm() {
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setSuccess("Password updated successfully.");
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 grid max-w-md gap-4">
      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <div>
        <label htmlFor="new-password" className={portalLabelClassName}>
          New password
        </label>
        <PasswordInput
          id="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={portalInputClassName}
        />
      </div>
      <div>
        <label htmlFor="confirm-password" className={portalLabelClassName}>
          Confirm new password
        </label>
        <PasswordInput
          id="confirm-password"
          required
          minLength={8}
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
  );
}
