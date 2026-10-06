# Staging-only data scripts

**Not part of the numbered production migration sequence.**

These files hardcode the **staging** Davors tenant (`00000001-0000-4000-8000-000000000001`) and must never be run against production.

Apply via:

```bash
npx tsx scripts/staging-only/apply-davors-staging-data-fixes.ts
```
