## Summary

-

## Risk

- [ ] Low-risk config/docs-only change
- [ ] App behavior change
- [ ] Deployment or security-sensitive change

## Verification

- [ ] `bun run typecheck`
- [ ] `bun run build`
- [ ] `bun run test`
- [ ] `bun run lint`
- [ ] `node scripts/check-design-drift.mjs` (UI changes)
- [ ] `bun run check:client-imports` (web/client changes)
- [ ] `bun run security` (security/dependency-sensitive changes)

## UI Checklist

- [ ] Uses `DESIGN.md` / `@theme` tokens only
- [ ] Reuses `apps/web/components/ui/*` primitives first
- [ ] Includes focus states on interactive elements
- [ ] Screenshots or recordings attached when visual behavior changes

## Rollout Notes

-
