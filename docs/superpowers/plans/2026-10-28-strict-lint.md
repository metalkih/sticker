# Strict lint implementation plan

Goal: add reproducible strict TypeScript/React linting without hiding or fixing the existing application baseline.
Architecture: flat ESLint configuration, type-aware typescript-eslint strict rules, React Hooks rules; scripts fail on warnings. Existing TypeScript strict compiler checks remain separate.
Scope: no Swift files exist; SwiftLint is inapplicable. No production behavior changes, suppression baseline, auto-fix, deployment or credential changes.

- [x] Install exact compatible dev dependency versions from npm; preserve existing runtime dependencies.
- [x] Write and run a failing configuration contract test before adding configuration.
- [x] Add eslint.config.mjs for TS/TSX and JavaScript tooling, including tests; ignore only generated output/dependencies.
- [x] Validate intentional bad TypeScript, floating promise, conditional hook examples through ESLint API; require each rule to fire.
- [x] Run complete lint JSON scan, group actual findings into reproducible issues without inferring runtime bugs from style rules.
- [x] Run config contract tests, application suite, typecheck, build, formatting and dependency audit; disclose failures.
- [ ] Independently review config and report; publish isolated branch and Draft PR, then read back commit and issues. Do not merge.

Review focus: tests must be linted; config must be self-linted; new TS files must be included; generated artifacts must be ignored; warning threshold must not conceal a red baseline.

## Compatibility decision

Use maintained ESLint 10, not EOL ESLint 9. The current JSX-a11y stable plugin declares peer compatibility only through ESLint 9, so it is not forced into this setup. Static accessibility lint coverage is not claimed. Browser/accessibility behavior still needs dedicated verification.

## Actions

Independent matrix checks run lint, lint-configuration contracts, typecheck, tests, build/compiled-server smoke and formatting. Permissions are contents:read, credentials are not persisted, and no production secrets or deployment occur. Existing application diagnostics intentionally keep the lint job red.
