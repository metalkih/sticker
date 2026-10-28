import { migrate } from "./migrations/index.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

/** A single local, relational database. Migrations are transactional. */
export function openDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, "sticker.sqlite");
  const db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    migrate(db);
    db.exec("PRAGMA journal_mode=WAL;");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
