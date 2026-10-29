# Search implementation checkpoints — 29 October 2026

## Phase 1: incremental lexical/responsiveness slice

Changed App local-library filter, Discover, top-bar suggestions, native catalogue relevance and focused tests. Local filtering stays synchronous and now supports token order/prefixes with NFC/Indic marks. Songs publish independently of entities; existing debounce, obsolete-generation guards and native caches/providers remain. Keyboard selection follows stable suggestion IDs. Native long Latin tokens permit one edit (including transposition), at most one corrected query token. Exact title/artist tiers outrank popularity. No online expansion, source verification or playback changes.

Validation: `npx vitest run src/domain/search.test.ts src/components/views/DiscoveryView.test.tsx src/components/common/TopBar.test.tsx`; `cargo test --manifest-path src-tauri/Cargo.toml --lib catalog_search::tests`; `npm run build`. Logs in test-results/search-phase1-*. Independent Gemini checks: delay entities and confirm songs appear first; change query during requests and check obsolete results never publish; keyboard-highlight song before artist batch and confirm Enter still opens that song; compare exact/partial/typo and conflicting artist/version candidates.

Limits: individual native providers still share the existing aggregate command barrier. Immediate local-library filtering is implemented; top-bar suggestions still query the catalogue. No 10k local p95 or live recall benchmark claimed. These remaining responsiveness targets need event/command API work rather than weakening cache completeness. No Gemini environment/config/profile scripts changed.

Git scope: the checkpoint includes pre-existing WIP in the touched tracked files (including prior Gini fixes). Other working-tree files remain unstaged; this is a scoped checkpoint, not a clean-room standalone baseline.
