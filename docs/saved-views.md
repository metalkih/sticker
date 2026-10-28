# Private saved views

Saved views store a project-scoped query, not an issue ID snapshot. New matching issues appear automatically. Each authenticated actor owns a separate view list, favorites order, and per-project default. A shared URL does not grant access to another actor's view or project.

The UI and HTTP/MCP query tools use the same bounded predicate implementation. Fields: project, text (key/title/description/labels), statuses, priorities, assignee, all-required labels, separate target/found/fixed version roles (including explicitly unassigned), unresolved blockers, and pending input requests. Owner input queries see scoped pending input requests; agents see only their own pending inputs, matching inbox permissions. Sort modes use stable numeric issue-key and ID tie breakers. UI selects one status/priority at a time; saved multi-value API predicates remain intact until edited.

GET `/api/issues?filter=<encoded JSON>` and POST `/api/issues/query` return `{issues,warnings}`. MCP `sticker_query_issues` returns the same shape. Legacy `sticker_list_issues` preserves its array return and scalar-status compatibility. The MCP saved-view list/get tools are read-only and actor-private.

View CRUD uses `/api/views` and `/api/views/:id`. Updates/deletes require the exact view revision. Preferences use `/api/view-preferences/:projectId` with an independent revision, ordered favorite IDs, and nullable default view ID. Duplicate names are rejected within an actor/project. Deleting a view clears its preference references, never its issues. Missing version references return explicit warnings and no issues rather than widening the query.

Examples in the UI are unsaved presets. They create no records until the owner saves them. Version examples name the actual selected version. A saved-view link restores predicates/mode/sort; issue detail navigation retains the view and draft filters. Project changes clear the selected view. A missing/private view shows an error rather than falling back to all issues. The ordinary board remains available when no default is configured.

Schema 5 adds saved views/preferences. Existing schema 4 issue, release, and relation records are retained. Backups remain validated read-only before restoration; unsupported future schema versions are refused.
