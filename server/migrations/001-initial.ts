import type { DatabaseSync } from "node:sqlite";

/** Original v1 schema, unchanged. */
export function initial(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      description TEXT NOT NULL, color TEXT NOT NULL, nextIssue INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE versions (
      id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('planned','released','archived')),
      dueDate TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      UNIQUE(projectId,name)
    );
    CREATE TABLE issues (
      id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('backlog','ready','in_progress','waiting','done','closed')),
      priority TEXT NOT NULL CHECK(priority IN ('none','low','medium','high','urgent')),
      assignee TEXT NOT NULL, targetVersionId TEXT REFERENCES versions(id) ON DELETE SET NULL,
      foundVersionId TEXT REFERENCES versions(id) ON DELETE SET NULL,
      fixedVersionId TEXT REFERENCES versions(id) ON DELETE SET NULL,
      labels TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE INDEX issue_project ON issues(projectId);
    CREATE TABLE comments (
      id TEXT PRIMARY KEY, issueId TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      body TEXT NOT NULL, authorId TEXT NOT NULL, authorName TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE INDEX comment_issue ON comments(issueId);
    CREATE TABLE activity (
      id TEXT PRIMARY KEY, issueId TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      action TEXT NOT NULL, detail TEXT NOT NULL, authorId TEXT NOT NULL, authorName TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE INDEX activity_issue ON activity(issueId);
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY, issueId TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('file','link')), name TEXT NOT NULL, url TEXT,
      storageKey TEXT UNIQUE, mimeType TEXT, size INTEGER NOT NULL,
      authorId TEXT NOT NULL, authorName TEXT NOT NULL, createdAt TEXT NOT NULL
    );
    CREATE INDEX attachment_issue ON attachments(issueId);
    CREATE TABLE agent_reports (
      id TEXT PRIMARY KEY, agentId TEXT NOT NULL, agentName TEXT NOT NULL,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      issueId TEXT REFERENCES issues(id) ON DELETE SET NULL,
      state TEXT NOT NULL CHECK(state IN ('idle','working','blocked','done')),
      message TEXT NOT NULL, reportedAt TEXT NOT NULL, UNIQUE(agentId,projectId)
    );
    `);
}
