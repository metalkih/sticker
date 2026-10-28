import type { DatabaseSync } from "node:sqlite";
export function resources(db: DatabaseSync) {
  db.exec(`
 CREATE TABLE resources(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,versionId TEXT,kind TEXT NOT NULL CHECK(kind IN ('markdown','file','link')),title TEXT NOT NULL,currentVersion INTEGER NOT NULL,revision INTEGER NOT NULL,isGuidance INTEGER NOT NULL DEFAULT 0,guidanceBy TEXT,guidanceAt TEXT,deletedAt TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,FOREIGN KEY(id,currentVersion) REFERENCES resource_versions(resourceId,version) DEFERRABLE INITIALLY DEFERRED);
 CREATE TABLE resource_versions(resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,version INTEGER NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,markdown TEXT,url TEXT,fileName TEXT,storageKey TEXT,mimeType TEXT,size INTEGER NOT NULL DEFAULT 0,checksum TEXT,authorId TEXT NOT NULL,authorName TEXT NOT NULL,createdAt TEXT NOT NULL,PRIMARY KEY(resourceId,version));
 CREATE TABLE issue_resource_links(id TEXT PRIMARY KEY,issueId TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,resourceId TEXT NOT NULL,resourceVersion INTEGER NOT NULL,createdBy TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(issueId,resourceId,resourceVersion),FOREIGN KEY(resourceId,resourceVersion) REFERENCES resource_versions(resourceId,version));
 CREATE TABLE session_resource_refs(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL,eventId TEXT NOT NULL,resourceId TEXT NOT NULL,resourceVersion INTEGER NOT NULL,recordedBy TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(sessionId,eventId,resourceId,resourceVersion),FOREIGN KEY(sessionId,eventId) REFERENCES session_events(sessionId,eventId) ON DELETE CASCADE,FOREIGN KEY(resourceId,resourceVersion) REFERENCES resource_versions(resourceId,version));
 CREATE TABLE resource_events(id TEXT PRIMARY KEY,resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,action TEXT NOT NULL,revision INTEGER NOT NULL,authorId TEXT NOT NULL,authorName TEXT NOT NULL,createdAt TEXT NOT NULL);
 CREATE TABLE resource_operations(actorId TEXT NOT NULL,kind TEXT NOT NULL,operationId TEXT NOT NULL,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,payloadHash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(actorId,kind,operationId));
 CREATE INDEX resources_project ON resources(projectId,deletedAt,updatedAt);
 CREATE INDEX resources_version ON resources(versionId);
 CREATE INDEX resource_link_source ON issue_resource_links(resourceId);
 CREATE INDEX resource_result_source ON session_resource_refs(resourceId);
`);
}
