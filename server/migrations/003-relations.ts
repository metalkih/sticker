import type { DatabaseSync } from "node:sqlite";
export function relations(db: DatabaseSync) {
  db.exec(`CREATE TABLE issue_relations (
 id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('parent','blocks','related')),
 sourceIssueId TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
 targetIssueId TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
 createdBy TEXT NOT NULL, createdAt TEXT NOT NULL,
 CHECK(sourceIssueId != targetIssueId), UNIQUE(kind,sourceIssueId,targetIssueId));
 CREATE UNIQUE INDEX issue_one_parent ON issue_relations(targetIssueId) WHERE kind='parent';
 CREATE INDEX issue_relation_source ON issue_relations(sourceIssueId);
 CREATE INDEX issue_relation_target ON issue_relations(targetIssueId);`);
}
