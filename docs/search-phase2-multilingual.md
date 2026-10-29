# Search Phase 2: sourced aliases and multilingual retrieval

29 October 2026. Builds on Phase 1 `6a27686` and initial Phase 2 `08f5357`. Only the original search checkout is changed; the parallel-lyrics worktree/branch and Gemini environment are untouched. Other existing WIP is excluded from the implementation checkpoint.

## Implementation and safety

- Interactive Discover and top-bar search use the existing `search_catalog` provider/cache/single-flight/ranking path for the original query and **at most one recovery query**. No native command, provider, database schema, playback path, lyrics file or package changed. Query display/history retain the original. Maximum input 200 code units / 12 tokens; result request is bounded to 60. Sparse results permit recovery; dense unrelated results may recover only when known identity evidence is missing. Identity-backed results precede unrelated originals without changing their relative order.
- Whole alias phrases can appear inside title/mixed queries. Aliases are accepted only from metadata with matching recording source ID and an actual structured MusicBrainz artist credit with the same stable ID. Unknown/name-only/ambiguous homonyms never establish equivalence. An ambiguous longer alias cannot fall back to a shorter alias fragment. Recovered alias candidates must still credit the exact artist ID; same display name with another ID is rejected. No cross-provider artist equivalence is invented.
- Existing native-to-Roman Sanscript conversion is reused per script run, retaining Latin tokens and NFC combining signs. Adjacent script blocks are processed independently. Search-only Tamil uses the existing lyric converter's first-unaspirated mapping algorithm on a cloned scheme, avoiding upstream `vanaghgham` for `வணக்கம்`. This changes no shared playback/lyric converter or upstream scheme.
- Known native titles from up to 128 recent saved tracks and 60 returned rows provide a reversible Roman lookup. Structured native performer names and sourced aliases provide artist forms. Native queries also try a Roman form where needed. Mixed queries can combine a native title with an artist alias in one recovery request. Saved records lack structured artist IDs and therefore supply **title forms only**, never guessed artist aliases.
- Roman/native form collisions are not language guesses. Different scripts/people require distinguishing credited artist context; otherwise recovery is suppressed. Recovered known-title candidates retain the known catalogue recording IDs. Accepted extra rows must match every expanded title/artist token and identity binding. Distinct IDs/releases/remix versions are never collapsed by this layer. The expanded query itself reaches the native relevance filter, so filtering is never performed only against the user's incompatible original script.
- Derived forms and metadata lookup terms are in-memory, capped at 256 entries each and 32 identities per term; existing provider caches remain authoritative. No new network alias/transliteration lookup, embeddings, accounts, models, paid APIs, migration or metadata rewrite. Failures preserve original successful results.
- Per-search AbortSignals stop follow-on work after query changes/unmount; existing UI generations reject late native results. Already dispatched native calls cannot be physically cancelled and still use existing single-flight/timeouts.
- Identity-backed recovered artists join existing Artists results by exact ID, with no extra entity request. No track cover is assigned as an artist portrait; profile navigation uses its stable ID. Original entity queries/albums remain unchanged.

## Focused validation

89 tests / six files passed; production TypeScript/Vite build passed. Commands:

```
npx vitest run src/domain/search-retrieval.test.ts src/domain/search-forms.test.ts src/domain/search.test.ts src/domain/source-matching.test.ts src/components/common/TopBar.test.tsx src/components/views/DiscoveryView.test.tsx
npm run build
```

Logs: `test-results/search-phase2-multilingual-tests.log`, `search-phase2-multilingual-build.log`. Domain fixtures cover Hindi/Marathi, Tamil, Telugu, Malayalam, Kannada, Bengali, Punjabi, Gujarati and Odia; these are deterministic transliteration/retrieval controls, **not real-song provider recall measurements**. Source-matching regressions preserve existing recording verification. Mocked retrieval verifies query budgets, scoped/missing IDs, artist credit negatives, same-name homonyms, alias phrases, Roman-to-native relevance survival, mixed queries, cross-script collisions, dense unrelated originals, separate remix IDs, cancellation, provider failure and artist-result publication.

## Gemini independent validation — pending

1. Review only this checkpoint relative to `08f5357`; do not import unrelated WIP or the parallel-lyrics baseline.
2. Replay real queries from the search audit, separating cold/warm provider cache and metadata-known/unknown sessions. For reverse forms, use a saved native title or first retrieve the native recording. For alias cases, first retrieve metadata carrying actual source-scoped aliases; no hardcoded alias dictionary exists.
3. Record original and recovery query, provider request counts, latency/first visible result, Recall@20/MRR, accepted/rejected IDs and wrong-version/artist results. Check one extra query maximum, success preservation on fallback failure, stale typing, keyboard ID selection as artist/song batches arrive, and both Songs/Artists categories. Existing debounce/provider budgets are unchanged.
4. Deliberately use same-name artists, ambiguous aliases, common Roman forms across scripts, missing collaborator IDs, native/Latin mixtures and a requested remix/live/female version. No display-name-only artist match or cross-language recording collapse is acceptable.
5. Confirm playback/queue/background Autoplay and original metadata are unchanged. Run Windows manual/native checks and Android separately when appropriate; no device performance claim is made here.

## Remaining limits

Roman-to-native recovery is evidence-backed, not a universal reverse transliterator. Regional phonetic spellings, schwa deletion, nukta/chillu edge cases and partial Roman field queries can still miss. Hindi and Marathi share a script; script alone never determines song language. Cross-provider matches missing the same stable artist ID are deliberately excluded from alias recovery. Metadata/form caches last only for the session; bounded eviction can reduce recall. No alias fetch/backfill or permanent library rewrite occurs. Local-library filtering itself remains the synchronous Phase 1 lexical filter; this slice uses saved metadata to improve online interactive retrieval. Album alias expansion and additional entity-provider queries are out of scope. Full native/manual validation, large-library performance and real multilingual recall benchmarks remain pending; independent validation should not infer quality from fixture pass counts.
