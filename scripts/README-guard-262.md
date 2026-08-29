# Guard 262 — `view_all_business_units` deploy safety

## Deploy order

1. Commit schema SQL + apply/guard + all app changes together  
2. Deploy app → staging **Ready**  
3. `npx tsx scripts/guard-262-deployed-view-all-bu.ts --env staging [--confirm-lock-view-all-gate]`  
4. Manual checklist (three-way switcher, BS/CF continuity, stamp refuse on All)  
5. `npx tsx scripts/apply-262-user-accounts-view-all-bu.ts --env staging --confirm-lock-view-all-gate`  
6. Same for production  

Never apply SQL on an environment whose live deploy predates this commit.

## Client markers (must appear in `/_next/static` chunks)

| Marker | Source |
|--------|--------|
| `view_all_business_units` | `VIEW_ALL_BUSINESS_UNITS_FIELD` |
| `dfoms-bu-view-all-no-stamp` | inside `STAMP_REFUSED_VIEW_ALL_MESSAGE` |
| `dfoms-bu-view-all-no-lock` | inside `LOCK_REQUIRES_SCOPED_BU_MESSAGE` |

Defined in `utils/business-unit-view.ts`.

## Lock gate UNVERIFIED

If `dfoms-bu-view-all-no-lock` is absent from client chunks (common — lock helpers are server-only), the guard requires:

```bash
--confirm-lock-view-all-gate
```

Only after you open **`utils/phase5e-lock.ts` on the deployed commit** and confirm Lock is blocked when `view_all` is true (and workspace default / specific BU remain allowed).

## Empty scan

0 chunks / SSO HTML = refuse (inconclusive), not a PASS.
