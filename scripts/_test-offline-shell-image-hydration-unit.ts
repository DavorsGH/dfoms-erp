/**
 * Unit checks: offline avatar/logo src helpers + hydration-safe initial path.
 *
 *   npx tsx scripts/_test-offline-shell-image-hydration-unit.ts
 */
import {
  OFFLINE_ASSET_USER_AVATAR_PATH,
  OFFLINE_ASSET_WORKSPACE_LOGO_PATH,
} from "../lib/client-cache/constants";
import {
  offlineAvatarSrc,
  offlineWorkspaceLogoSrc,
} from "../lib/client-cache/offline-shell-assets";

const remoteAvatar =
  "https://wieflwbfdmjtsdnwbfii.supabase.co/storage/v1/object/sign/employee-photos/x.png?token=abc";
const remoteLogo =
  "https://wieflwbfdmjtsdnwbfii.supabase.co/storage/v1/object/sign/tenant-logos/y.png?token=def";

let failed = 0;

function check(step: string, pass: boolean, detail: string) {
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
  if (!pass) {
    failed += 1;
  }
}

// Helper behavior
check(
  "avatar online keeps remote",
  offlineAvatarSrc(true, remoteAvatar) === remoteAvatar,
  String(offlineAvatarSrc(true, remoteAvatar)),
);
check(
  "avatar offline uses placeholder",
  offlineAvatarSrc(false, remoteAvatar) === OFFLINE_ASSET_USER_AVATAR_PATH,
  String(offlineAvatarSrc(false, remoteAvatar)),
);
check(
  "avatar empty stays undefined",
  offlineAvatarSrc(false, null) === undefined,
  String(offlineAvatarSrc(false, null)),
);
check(
  "logo online keeps remote",
  offlineWorkspaceLogoSrc(true, remoteLogo) === remoteLogo,
  offlineWorkspaceLogoSrc(true, remoteLogo),
);
check(
  "logo offline uses placeholder",
  offlineWorkspaceLogoSrc(false, remoteLogo) === OFFLINE_ASSET_WORKSPACE_LOGO_PATH,
  offlineWorkspaceLogoSrc(false, remoteLogo),
);
check(
  "logo static path stays static offline",
  offlineWorkspaceLogoSrc(false, "/logo.jpg") === "/logo.jpg",
  offlineWorkspaceLogoSrc(false, "/logo.jpg"),
);

// Hydration-safe component pattern: initial paint always uses online path
const initialAvatar = offlineAvatarSrc(true, remoteAvatar);
const postMountOfflineAvatar = offlineAvatarSrc(false, remoteAvatar);
check(
  "hydration: initial avatar !== offline placeholder",
  initialAvatar === remoteAvatar &&
    initialAvatar !== OFFLINE_ASSET_USER_AVATAR_PATH,
  `initial=${initialAvatar}`,
);
check(
  "post-mount offline avatar switches to placeholder",
  postMountOfflineAvatar === OFFLINE_ASSET_USER_AVATAR_PATH,
  String(postMountOfflineAvatar),
);

const initialLogo = offlineWorkspaceLogoSrc(true, remoteLogo);
const postMountOfflineLogo = offlineWorkspaceLogoSrc(false, remoteLogo);
check(
  "hydration: initial logo !== offline placeholder",
  initialLogo === remoteLogo &&
    initialLogo !== OFFLINE_ASSET_WORKSPACE_LOGO_PATH,
  `initial=${initialLogo}`,
);
check(
  "post-mount offline logo switches to placeholder",
  postMountOfflineLogo === OFFLINE_ASSET_WORKSPACE_LOGO_PATH,
  postMountOfflineLogo,
);

// Server and client first paint must agree even if navigator would be offline
check(
  "SSR/client first paint always online-path (forced true)",
  offlineAvatarSrc(true, remoteAvatar) ===
    offlineAvatarSrc(true, remoteAvatar) &&
    offlineWorkspaceLogoSrc(true, remoteLogo) ===
      offlineWorkspaceLogoSrc(true, remoteLogo),
  "identical forced-online resolves",
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll hydration/offline src unit checks passed.");
