import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { MAX_RESOURCE_FILE_BYTES } from "./contracts/resources.js";
/** Called only after the fixed schema manifest validates the resource tables. Reads every version, including tombstones. */
export function validateResourceVersionFiles(
  root: string,
  db: DatabaseSync,
): number {
  const files = new Map<string, { size: number; checksum: string }>();
  for (const row of db
    .prepare(
      "SELECT storageKey,size,checksum FROM resource_versions WHERE kind='file'",
    )
    .all()) {
    if (
      typeof row.storageKey !== "string" ||
      !z.uuid().safeParse(row.storageKey).success
    )
      throw new Error("Resource file storageKey is not a valid UUID.");
    if (
      typeof row.size !== "number" ||
      !Number.isSafeInteger(row.size) ||
      row.size < 0 ||
      row.size > MAX_RESOURCE_FILE_BYTES
    )
      throw new Error("Resource file recorded size is invalid.");
    if (
      typeof row.checksum !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.checksum)
    )
      throw new Error("Resource file checksum is invalid.");
    const previous = files.get(row.storageKey);
    if (
      previous &&
      (previous.size !== row.size || previous.checksum !== row.checksum)
    )
      throw new Error(
        "Resource versions have inconsistent shared file metadata.",
      );
    files.set(row.storageKey, { size: row.size, checksum: row.checksum });
  }
  const directory = join(resolve(root), "uploads");
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Resource uploads must be a real directory, not a link.");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT" &&
      files.size === 0
    )
      return 0;
    throw new Error("Resource uploads directory is missing or unsafe.", {
      cause: error,
    });
  }
  for (const [key, expected] of files) {
    const path = join(directory, key);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      throw new Error("Resource file is missing.");
    }
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Resource file must be a regular file, not a link.");
    if (stat.size !== expected.size)
      throw new Error("Resource file size mismatch.");
    const checksum = createHash("sha256")
      .update(readFileSync(path))
      .digest("hex");
    if (checksum !== expected.checksum)
      throw new Error("Resource file checksum mismatch.");
  }
  return files.size;
}
