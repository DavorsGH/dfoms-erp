export type LesseePortalAccessState =
  | "active"
  | "invited"
  | "not_invited"
  | "former";

export function deriveLesseePortalAccessState(args: {
  authUserId: string | null | undefined;
  status: string | null | undefined;
  pendingInviteExpiresAt: string | null | undefined;
  now?: Date;
}): LesseePortalAccessState {
  const hasAuth = Boolean(
    typeof args.authUserId === "string" && args.authUserId.trim(),
  );
  if (hasAuth) {
    return "active";
  }

  if (args.status === "former") {
    return "former";
  }

  const expiresAt = args.pendingInviteExpiresAt;
  if (expiresAt) {
    const expiresMs = new Date(expiresAt).getTime();
    const nowMs = (args.now ?? new Date()).getTime();
    if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
      return "invited";
    }
  }

  return "not_invited";
}

export function formatLesseePortalAccessState(
  state: LesseePortalAccessState,
): string {
  switch (state) {
    case "active":
      return "Active (linked)";
    case "invited":
      return "Invited";
    case "former":
      return "Former (revoked)";
    case "not_invited":
      return "Not invited";
  }
}
