# Supabase Auth setup (manual dashboard settings)

These settings live in the **Supabase Dashboard** for each project (staging and production). They are **not** stored in this repo. Re-run this checklist after a new Supabase project, branch reset, or Auth template restore.

## Site URL and redirect URLs

In **Authentication → URL Configuration**:

- **Site URL** — production app origin (e.g. `https://your-app.vercel.app`) or staging URL for the staging project.
- **Redirect URLs** — allow at least:
  - `https://<app>/reset-password`
  - `https://<app>/landlord-portal/reset-password`
  - `https://<app>/portal/reset-password`
  - OAuth callback: `https://<app>/auth/callback`

Use the same paths for local dev with `http://localhost:3000` when testing locally.

## Reset Password email template (required)

In **Authentication → Email Templates → Reset Password**, set the action link to the **token_hash** shape so recovery works with the shared `/reset-password` page and our client-side `verifyOtp` handler:

```html
<a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">Reset Password</a>
```

Apply this in **both** staging and production Supabase projects.

Why:

- All personas (staff, landlord, lessee) can use the same template and land on `/reset-password`.
- The app establishes the recovery session from `token_hash` + `type=recovery` (see `utils/auth/establish-recovery-session.ts`).
- After a successful password update, the app resolves the account persona and redirects to the correct portal login (or the portal chooser when no active persona exists).

If this template is reverted to the default Supabase link, password reset emails may stop working until the template is fixed again.

## OAuth providers

Configure Google and Microsoft (Azure) under **Authentication → Providers** on both projects. Redirect URI must match `/auth/callback` on the corresponding Site URL.

## Session / JWT (optional probe)

```bash
npx tsx scripts/probe-supabase-auth-session-config.ts staging
npx tsx scripts/probe-supabase-auth-session-config.ts production
```
