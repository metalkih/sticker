import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
export function sessions(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE agent_sessions (
      id TEXT PRIMARY KEY, externalSessionId TEXT NOT NULL,
      agentId TEXT NOT NULL, agentName TEXT NOT NULL,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      issueId TEXT REFERENCES issues(id) ON DELETE SET NULL,
      startedAt TEXT NOT NULL, lastReportedAt TEXT NOT NULL, endedAt TEXT, closedAt TEXT,
      revision INTEGER NOT NULL CHECK(revision>0), legacy INTEGER NOT NULL DEFAULT 0 CHECK(legacy IN (0,1)),
      closeOperationId TEXT, closeRevision INTEGER,
      UNIQUE(agentId,projectId,externalSessionId)
    );
    CREATE INDEX session_project ON agent_sessions(projectId);
    CREATE TABLE session_events (
      sessionId TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
      eventId TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('report','request','result','error','end')),
      occurredAt TEXT NOT NULL, receivedAt TEXT NOT NULL, message TEXT NOT NULL, payload TEXT NOT NULL, fingerprint TEXT NOT NULL,
      PRIMARY KEY(sessionId,eventId)
    );
    CREATE TABLE session_requests (
      id TEXT PRIMARY KEY, sessionId TEXT NOT NULL, eventId TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('input','review')), prompt TEXT NOT NULL, createdAt TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0), status TEXT NOT NULL CHECK(status IN ('pending','answered','closed')),
      closeOperationId TEXT, closeRevision INTEGER,
      FOREIGN KEY(sessionId,eventId) REFERENCES session_events(sessionId,eventId) ON DELETE CASCADE,
      UNIQUE(sessionId,eventId)
    );
    CREATE TABLE session_responses (
      id TEXT PRIMARY KEY, requestId TEXT NOT NULL UNIQUE REFERENCES session_requests(id) ON DELETE CASCADE,
      authorId TEXT NOT NULL, operationId TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL, createdAt TEXT NOT NULL,
      UNIQUE(authorId,operationId)
    );
  `);
  for (const row of db.prepare("SELECT * FROM agent_reports").all()) {
    const sessionId = randomUUID();
    const payload = JSON.stringify(
      row.state === "working" || row.state === "idle" || row.state === "blocked"
        ? { state: row.state }
        : {},
    );
    db.prepare(
      "INSERT INTO agent_sessions (id,externalSessionId,agentId,agentName,projectId,issueId,startedAt,lastReportedAt,endedAt,closedAt,revision,legacy) VALUES (?,?,?,?,?,?,?,?,?,NULL,1,1)",
    ).run(
      sessionId,
      `legacy:${String(row.issueId ?? "project")}`,
      row.agentId,
      row.agentName,
      row.projectId,
      row.issueId,
      row.reportedAt,
      row.reportedAt,
      row.state === "done" ? row.reportedAt : null,
    );
    db.prepare("INSERT INTO session_events VALUES (?,?,?,?,?,?,?,?)").run(
      sessionId,
      `legacy:${String(row.id)}`,
      row.state === "done" ? "end" : "report",
      row.reportedAt,
      row.reportedAt,
      row.message,
      payload,
      JSON.stringify({ legacyReportId: row.id }),
    );
  }
}
