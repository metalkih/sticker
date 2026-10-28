# Shared resources UI plan

The user delegated design choices. Reuse the existing React/typed API, hash routing and authenticated resource contracts; no new dependencies or backend changes. Coordinator owns publication, real hosted browsers/Docker, and live dogfood data.

## Design

Project-scoped resource workspace with optional owning-version and kind/search filters. A compact list opens a named detail view; mobile stacks controls/cards with readable long titles/URLs/SHA. Detail separates exact selected content version, current metadata revision, owner-designated guidance, immutable history, usage and actor/time audit. Missing/tombstoned/version-unavailable records are explicit, never broaden queries or label unknown permissions as allowed.

Markdown renders a bounded safe subset directly as React text/elements (headings, paragraphs, lists, fenced code, emphasis/code and validated links); no raw HTML, remote images, iframe, fetch or executable content. Files only preview server-detected raster through authenticated endpoint; all other formats download. Fetch-and-blob download reports failures without navigating away or leaking draft state.

Editor owns frozen initial revision and content, retains fields on validation/network/CAS failure, accepts confirmed mutation response without depending on a later GET. Conflicts show separately fetched current metadata and require explicit draft-preserving review/rebase. Guidance/delete confirmations capture exact target/revision; only owners designate guidance. Same-document dirty navigation and page unload use existing route guard; cancel/discard is explicit. File operation IDs are stable for exact retries, changed payload gets a new ID.

Issue picker connects exact immutable versions with current issue revision, shows pinned old/tombstoned references, unlinks only the edge. Session detail lists exact result-event resource references and recorded actor; no execution authority is implied. Existing legacy attachments remain untouched.

## Steps / files / tests

1. `SafeMarkdown.tsx`, `ResourceContent.tsx`: RED/green DOM for inert HTML/SVG/javascript/image inputs, safe links, code/long text and download failure.
2. `ResourceEditor.tsx`: real-API RED/green create/edit Markdown/link/file, frozen baseline/CAS review, draft guard, exact retry ID, owner guidance constraints.
3. `ResourceDetail.tsx`, `ResourceWorkspace.tsx`: scoped list/filter/detail/history/tombstones/usage, manual path-bound caches and accepted snapshots; errors never show stale data as fresh.
4. `IssueResources.tsx`, `SessionResourceReferences.tsx`: exact-version picker/link/unlink and session evidence; readonly/closed guards, preserved old bytes.
5. Narrow App/router/IssuePanel/SessionDetail entries, styles, API docs. Resource/deep-link state must normalize on other section/project transitions; add router regressions.
6. Hosted `tests/ui/resources.spec.ts`: actual owner create/edit/CAS, guidance, invalid inputs, file safety/download, old pinned version after update/unlink,375px nooverflow, keyboard/focus/cancel/back, screenshots. Do not launch local browser.
7. Full native suite/lint0/typecheck/format/build/production, independent review, parent hosted browser/Docker integration. No completion claim until corresponding evidence exists.
