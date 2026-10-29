# Search implementation checkpoints — 29 October 2026

## Phase 1: incremental lexical/responsiveness slice

Changed App local-library filter, Discover, top-bar suggestions, native catalogue relevance and focused tests. Local filtering stays synchronous and now supports token order/prefixes with NFC/Indic marks. Songs publish independently of entities; existing debounce, obsolete-generation guards and native caches/providers remain. Keyboard selection follows stable suggestion IDs. Native long Latin tokens permit one edit (including transposition), at most one corrected query token. Exact title/artist tiers outrank popularity. No online expansion, source verification or playback changes.

Validation: `npx vitest run src/domain/search.test.ts src/components/views/DiscoveryView.test.tsx src/components/common/TopBar.test.tsx`; `cargo test --manifest-path src-tauri/Cargo.toml --lib catalog_search::tests`; `npm run build`. Logs in test-results/search-phase1-*. Independent Gemini checks: delay entities and confirm songs appear first; change query during requests and check obsolete results never publish; keyboard-highlight song before artist batch and confirm Enter still opens that song; compare exact/partial/typo and conflicting artist/version candidates.

Limits: individual native providers still share the existing aggregate command barrier. Immediate local-library filtering is implemented; top-bar suggestions still query the catalogue. No 10k local p95 or live recall benchmark claimed. These remaining responsiveness targets need event/command API work rather than weakening cache completeness. No Gemini environment/config/profile scripts changed.

Git scope: the checkpoint includes pre-existing WIP in the touched tracked files (including prior Gini fixes). Other working-tree files remain unstaged; this is a scoped checkpoint, not a clean-room standalone baseline.


Phase 1 Git checkpoint: `6a27686`. Final Phase 1 validation: 14 Rust tests passed / two explicit audits ignored; 12 frontend tests passed; production build passed. The Rust regression expectation was corrected to recognize `kesariy` as an existing prefix match rather than a typo.

## Phase 2: sourced aliases and mixed-script recovery slice

Interactive Discover and top-bar search now use `src/domain/search-retrieval.ts`. Existing provider commands/cache keys/ranking/filtering remain authoritative for each original or recovery query. A sparse result (< five, or requested limit when smaller) permits one extra request, never recursive expansion. Original results keep their order; recovered results append with ID-only deduplication, retaining different releases and versions. Playback, source resolution, recommendations and background Autoplay do not use this wrapper.

Aliases are learned only from returned recording metadata whose sourceId matches the recording, and whose alias artist ID matches an actual structured MusicBrainz credit. Exact full-alias queries expand only when one artist identity is known; ambiguous homonyms do not expand. There is no hardcoded celebrity mapping, remote alias lookup or rewriting of stored metadata. Session-memory caches are bounded (256 aliases/forms, at most 32 artist identities per alias). Existing native catalogue cache/single-flight handles repeated retrieval.

Native Indic runs use the installed `searchRoman`/Sanscript converter; Latin tokens in mixed queries survive. Conversion is memoized locally and does not run for ordinary Latin queries. Original query is retained in the UI. Failure returns successful original results. No dependencies, migrations, paid endpoints, model packs or Gemini test-environment changes.

Validation: 60 focused frontend tests across five files passed (retrieval, local filtering, source-matching safeguards, top bar, Discover); production build passed. Logs: `test-results/search-phase2-tests.log`, `search-phase2-build.log`. Run `npx vitest run src/domain/search-retrieval.test.ts src/domain/search.test.ts src/domain/source-matching.test.ts src/components/common/TopBar.test.tsx src/components/views/DiscoveryView.test.tsx` and `npm run build` independently.

Gemini validation: compare original/native/mixed queries; inspect request count (zero extra on dense results, at most one on sparse); simulate failed fallback; replay same-name artists with separate IDs; confirm playback/Autoplay still call the unchanged native adapter. No test environment setup was changed. Full deferred-promise UI interaction/manual Windows/Android validation and live recall/latency measurements remain pending.

Limits: alias coverage depends on already-returned provider metadata and lasts for the app session; no library backfill. Alias substring expansion, arbitrary Roman-to-native variants, native-to-native cross-script mapping and fuzzy alias matching are not implemented. Sparse-result gating can miss desired songs when five unrelated results already exist. Recovery currently waits before the song category resolves; a future progressive recovery channel should label additional matches explicitly and avoid that delay. Individual-provider streaming, top-bar local-track suggestions, 100-query corpus and 10k local latency acceptance remain open Phase 1 targets. Do not claim the entire roadmap phase or multilingual recall targets are complete.
