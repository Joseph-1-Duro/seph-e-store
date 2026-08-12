# AGENTS.md

## Project

pnpm + Turbo monorepo. Run all commands from the repo root — never `pnpm install` or run scripts inside `apps/*`.

- `apps/site` — public shop. Next.js 16 (App Router), React 19, strict TS, `@/*` → `src/*`, React Compiler on.
- `apps/admin` — admin panel. **Vite + React 19 + react-router v8, NOT Next.js.** Build is `tsc -b && vite build`; React Compiler via babel plugin.
- `packages/` — `@repo/ui` (exports `./*` → `src/*.tsx`), `@repo/eslint-config` (only used by `packages/*`; both apps have their own eslint configs), `@repo/typescript-config`.

## Commands

- `pnpm dev` — runs both apps in parallel (site on :3000, admin on Vite's default).
- `pnpm build` / `pnpm lint` — turbo across all packages.
- `pnpm check-types` — only runs where the script exists (currently `packages/ui` only); site/admin typecheck happens inside their builds.
- `pnpm format` — prettier over `**/*.{ts,tsx,md}`.

## Skills

- Read `TODO.md` first — it's the live task list (and gitignored, so not visible in git).
- `.github/skills/scss-conventions` — all SCSS/styling work: plain `.scss`, one file per component, BEM, no CSS Modules. Existing scaffold still uses `globals.css`/`page.module.css`; migrate to SCSS per this skill.
- `.github/skills/web-design-guidelines` — UI/UX reviews.
- `.github/skills/firebase-basics` / `firebase-firestore` / `firebase-auth-basics` / `firebase-security-rules-auditor` — all Firebase work (Firestore = BaaS). Official skills from `firebase/agent-skills`.
- `.github/skills` is registered in `opencode.json` via `skills.paths` so these load as skills (restart opencode after changing skill files).
- `docs/proposal.md` — architecture spec for site/admin split, Firebase pattern, data model, payments.

## Conventions

- Don't install packages without permission — state why first.
- Don't run git commands; do only what's asked; don't read any `.env` file.
- When asked to evaluate/review the initial implementation, rate it out of 5 first.
- DRY; keep logic out of UI components and suggest a refactor when mixed.
- camelCase functions; suffix files by purpose: `*.store.ts`, `*.schema.ts`, `*.type.ts`.
- Types derive from zod via `z.infer` in `src/schemas`, never duplicated (zod not yet installed).

## Gotchas

- Firebase image URLs will need `images.remotePatterns` in `apps/site/next.config.ts` — not yet configured.
- Stray `apps/site/pnpm-lock.yaml` / nested `node_modules` exist from an accidental in-app install; install only from the root workspace.
