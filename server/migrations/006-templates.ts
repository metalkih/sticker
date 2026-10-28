import type { DatabaseSync } from "node:sqlite";
export function templates(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE issue_templates(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,name TEXT NOT NULL,currentVersion INTEGER NOT NULL CHECK(currentVersion>0),revision INTEGER NOT NULL CHECK(revision>0),deletedAt TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
    CREATE INDEX template_project ON issue_templates(projectId);
    CREATE TABLE template_versions(templateId TEXT NOT NULL REFERENCES issue_templates(id) ON DELETE CASCADE,version INTEGER NOT NULL CHECK(version>0),body TEXT NOT NULL,requiredFields TEXT NOT NULL,defaults TEXT NOT NULL,authorId TEXT NOT NULL,authorName TEXT NOT NULL,createdAt TEXT NOT NULL,PRIMARY KEY(templateId,version));
    CREATE TABLE template_operations(actorId TEXT NOT NULL,operationId TEXT NOT NULL,payload TEXT NOT NULL,templateId TEXT NOT NULL REFERENCES issue_templates(id) ON DELETE CASCADE,PRIMARY KEY(actorId,operationId));
    ALTER TABLE issues ADD COLUMN templateId TEXT REFERENCES issue_templates(id);
    ALTER TABLE issues ADD COLUMN templateVersion INTEGER CHECK((templateId IS NULL AND templateVersion IS NULL) OR (templateId IS NOT NULL AND templateVersion IS NOT NULL AND templateVersion>0));
    CREATE TABLE issue_creation_operations(actorId TEXT NOT NULL,operationId TEXT NOT NULL,payload TEXT NOT NULL,issueId TEXT REFERENCES issues(id) ON DELETE SET NULL,PRIMARY KEY(actorId,operationId));
  `);
}
