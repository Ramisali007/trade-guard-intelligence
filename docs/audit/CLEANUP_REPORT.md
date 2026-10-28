# Cleanup report — unused code review (2026-10-27)

Scope: the "clean architecture and unused-code" phase of the audit, done after the functional and security fixes. Method: [knip](https://knip.dev) 5 run through `npx` (nothing was added to either project), then **every candidate was checked by hand** with a repository-wide search (code, scripts, docs, READMEs) before anything was removed. The analyser alone was not trusted: my first scripted counting of "names that appear once" was wrong (it reported `RagService`, `AnalyticsService` and others as dead; plain `grep -w` showed they are used), so the final list below comes from `grep`, not from that script.

## Removed (each: no reference anywhere except its own definition)

| Item | Where | Why it was safe | Note |
|---|---|---|---|
| `optionalAuthenticate` | `backend/src/middleware/auth.middleware.ts` | 0 references. Authentication that "continues if not authenticated" is a hazard when it exists unused: a future route could adopt it by accident. | The authentication path every route uses (`authenticate`) is untouched. |
| `getAuditActor` | same | 0 references; services build actors from the token themselves (`actorRef`). | |
| `BANKING_ROLES` alias (and the `ROLE_IDS` import it needed) | same | 0 references; `BankingRole` type kept. | |
| `missingRequiredFields` | `backend/src/trade-cases/trade-case.service.ts` | 0 references anywhere in backend, frontend, scripts or docs (its comment said the UI should flag missing fields; nothing calls it). | |
| `isKnownUnit` | `backend/src/compliance/pricing/unit-conversion.ts` | 0 references. | |
| `emptySentimentDistribution` (and its import) | `backend/src/ai/providers/heuristic.provider.ts` | 0 references. | |
| `getAuthorityCitation` | `backend/src/compliance/regulatory/regulatory-citations.ts` | 0 references; the map it reads is used directly. | |
| `computeBestEffortFingerprint` | `backend/src/utils/fingerprint.ts` | 0 references. It was a weak (name, page count, word count) fingerprint that must not be mistaken for the content hash used for deduplication. | |
| `TaxonomyService` | `frontend/src/app/services/taxonomy.service.ts` | 0 references in `src`, docs or READMEs; nothing injects it. The backend `/api/taxonomy` route it called remains. | Backed up in the session scratch area before deletion. |
| `@types/gsap` (devDependency) | `frontend/package.json` | `gsap` 3 ships its own types; `@types/gsap` is the obsolete 1.x package. The only import (`staggered-menu.component.ts`) builds without it. | `package-lock.json` updated by `npm uninstall`. |

## Deliberately kept

| Item | Reason |
|---|---|
| `scripts/generate_liberty_dossier.js`, `migrate_atlas_to_local.js`, `verify_dual_write.ts`, `generate-rbac-matrix.ts` | knip lists them as unused files because nothing imports them, but they are manual tools documented in the README and `docs/RBAC_PERMISSION_MATRIX.md`. |
| `setWorkflowPolicyForTesting`, `resetGuardsForTesting` | deliberate test seams (0 references today; removing them removes the ability to test those modules). |
| ~40 exported symbols (mostly types and constants) that are used only inside their own file | harmless over-exports; removing the `export` keyword is churn without behaviour benefit. |
| `requireRole` | flagged by its own comment as legacy, but still referenced by `security.test.ts`. |
| All migrations, fixtures, public assets, configuration files | not touched; there is no evidence they are unnecessary. |
| 146 `no-explicit-any` lint warnings | see below. |

## Not done, with the reason

- **The 146 `any` warnings.** Sampled across the codebase: they are almost entirely genuinely dynamic data (JSON from external feeds and from the AI model, import payloads, mock objects in tests). Converting them to `unknown` forces a cast at every use, which adds risk and noise without changing behaviour. The lint rule is configured as a warning by the project. I did not add any: two warnings my own new test introduced were typed away, so the count is unchanged at 146.
- **Circular dependencies and duplicate implementations** were not analysed; knip does not report them. A dedicated pass (for example with `madge`) would be needed before claiming there are none.
- **Duplicate export** reported by knip: `sanitizeForCsvInjection` / `sanitizeCsvCell` in `entity-registry.ts` are two names for one function. Left as is: `sanitizeCsvCell` is a one-line alias (`= sanitizeForCsvInjection`), and both names are used (the import code and `hardening.test.ts` use one, `import.test.ts` the other).

## Verification after the cleanup

Backend `npm run typecheck`, `npm run lint` (0 errors), `npm run build`, the 21-suite `npm test` chain, the live MongoDB suite and `npm run test:probe` were re-run after the removals; frontend `ng build`, 37 of 37 unit specs and `npm audit` were re-run after removing `TaxonomyService` and `@types/gsap`. Results are in [TEST_EXECUTION_REPORT.md](TEST_EXECUTION_REPORT.md), section 7.
