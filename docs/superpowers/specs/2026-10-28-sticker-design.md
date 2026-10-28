# 스티커 — design

## Intent

A private issue-tracking workspace for one owner and their coding agents. Projects, versions, issues and attachments belong together; the UI feels like layered paper stickers while remaining legible and dense. Korean interface, desktop and iPhone usable.

The user delegated design decisions and opted out of approval questions. These architecture choices are builder decisions, not additional user requirements.

## Approaches and chosen architecture

A full multi-service PostgreSQL deployment would scale teams but adds maintenance the single-owner brief does not need. A static mock cannot persist issues or offer MCP. Choose one TypeScript Express application serving a React/Vite SPA, SQLite via Node 24 built-in sqlite, on-disk uploads, and an official MCP SDK STDIO adapter calling the authenticated HTTP API. One Docker image and Compose volume. SQLite is relational, transactional, and suitable for this owner workload.

## Global constraints

- App name is 스티커 (Sticker); UI labels are Korean.
- Private owner plus coding agents; no team invitation flows.
- Default Docker port binding is 127.0.0.1:8787; authentication is required, never a default password.
- No persistent live tokens/grants are created during development; only temporary test fixtures.
- Browser and MCP share API/domain validation, project scopes and immutable author attribution.
- Waiting issues never autorun; this product does not execute shell or run coding agents.
- Agent reports are timestamped self-reports, not evidence of a running process; reports older than five minutes are stale.
- Implementation completion (done) and owner closure (closed) are distinct. Only owner may close/reopen a closed issue.
- Target/found/fixed versions must belong to the issue project.
- Do not use the user's Mac, touch canceled projects, publish a remote repository/image, or deploy publicly.

## Data and behavior

Projects: name, unique key, description, color. Versions: project, name, state (planned/released/archived), due date, description. Issues: project sequence key, title, description, status (backlog, ready, in_progress, waiting, done, closed), priority, assignee, target/found/fixed version, labels; timestamps. CRUD with transactional activity history. Comments and file/link resources attach to issues. A file attachment is private, bounded to 20 MiB, random storage key, attachment disposition except safe raster previews, with no HTML/SVG inline rendering. Links are http/https only and never fetched server-side.

Owner config supplies a password; login creates expiring HttpOnly SameSite=Strict sessions. Agent config supplies hashed tokens with actor name, optional project ID scope and read/write scope. Agent writes cannot impersonate the owner or close issues. Configuration is operator-managed, no automatic token enrollment. CSRF protection checks Origin for cookie-authenticated writes and JSON requests. API errors stay actionable without stack traces.

UI: paper-white canvas, charcoal sidebar, chartreuse/orange/lilac stickers, tight issue board/list and project/version views; detail side panel with history, comments and resources. Empty real installation has helpful getting-started state, not fabricated data. Optional explicitly invoked demo fixture is isolated test-only.

## Non-goals and limits

Not a full Linear clone: no teams, billing, public sharing links, arbitrary automation, notifications, realtime collaboration, drag-and-drop promise, or live agent orchestration. Attachments are shared among authorized owner/agent clients, not public. Concurrency target is a personal workspace. Backup/restore stops service and copies both database and files consistently.
