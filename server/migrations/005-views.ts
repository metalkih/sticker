import type { DatabaseSync } from "node:sqlite";
export function views(db: DatabaseSync) {
  db.exec(`CREATE TABLE saved_views (
 id TEXT PRIMARY KEY,actorId TEXT NOT NULL,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,name TEXT NOT NULL COLLATE NOCASE,query TEXT NOT NULL,revision INTEGER NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,UNIQUE(actorId,projectId,name));
 CREATE INDEX saved_views_actor_project ON saved_views(actorId,projectId);
 CREATE TABLE view_preferences (actorId TEXT NOT NULL,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,revision INTEGER NOT NULL,defaultViewId TEXT REFERENCES saved_views(id) ON DELETE SET NULL,favoriteIds TEXT NOT NULL,PRIMARY KEY(actorId,projectId));`);
}
