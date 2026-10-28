import type { DatabaseSync } from "node:sqlite";
export function releases(db: DatabaseSync) {
  db.exec(`
 ALTER TABLE versions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0);
 CREATE TABLE version_changelogs(versionId TEXT PRIMARY KEY REFERENCES versions(id) ON DELETE CASCADE, markdown TEXT NOT NULL, selectedIssueIds TEXT NOT NULL, revision INTEGER NOT NULL, authorId TEXT NOT NULL, authorName TEXT NOT NULL, updatedAt TEXT NOT NULL);
 CREATE TABLE version_changelog_history(id TEXT PRIMARY KEY,versionId TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,markdown TEXT NOT NULL,selectedIssueIds TEXT NOT NULL,revision INTEGER NOT NULL,authorId TEXT NOT NULL,authorName TEXT NOT NULL,updatedAt TEXT NOT NULL,UNIQUE(versionId,revision));
 CREATE TABLE version_release_audit(id TEXT PRIMARY KEY,versionId TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,authorId TEXT NOT NULL,authorName TEXT NOT NULL,fromState TEXT NOT NULL,toState TEXT NOT NULL,reviewedRevision INTEGER NOT NULL,operationId TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(authorId,operationId));
 CREATE TABLE release_operations(actorId TEXT NOT NULL,kind TEXT NOT NULL,operationId TEXT NOT NULL,versionId TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,payload TEXT NOT NULL,result TEXT NOT NULL,createdAt TEXT NOT NULL,PRIMARY KEY(actorId,kind,operationId));
`);
}
