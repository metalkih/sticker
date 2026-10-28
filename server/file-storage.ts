import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  lstatSync,
  writeFileSync,
  unlinkSync,
  openSync,
  closeSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { DomainError } from "./domain-error.js";
import { MAX_RESOURCE_FILE_BYTES } from "./contracts/resources.js";
export function normalizeFileName(value: string) {
  const clean = basename(
    Buffer.from(value, "utf8").toString("utf8").replaceAll("\\", "/"),
  );
  let name = "";
  for (const char of clean) {
    if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) continue;
    // Keep the established 255 UTF-16-unit cap without cutting a code point.
    if (name.length + char.length > 255) break;
    name += char;
  }
  name = name.trim();
  return !name || name === "." || name === ".." ? "attachment" : name;
}
export function detectFileMime(bytes: Buffer): string {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return "application/octet-stream";
}
export interface StoredFile {
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
}
/** Opaque file bytes only; callers authorize projects/resources before invoking storage. */
export class FileStorage {
  private readonly root: string;
  constructor(
    dataDir: string,
    private readonly uuid: () => string = randomUUID,
  ) {
    this.root = join(resolve(dataDir), "uploads");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Uploads must be a real directory, not a link.");
  }
  private keyPath(key: string) {
    if (!z.uuid().safeParse(key).success)
      throw new DomainError(
        404,
        "FILE_MISSING",
        "저장 파일을 찾을 수 없습니다.",
      );
    return join(this.root, key);
  }
  write(bytes: Buffer, name: string): StoredFile {
    if (bytes.length > MAX_RESOURCE_FILE_BYTES)
      throw new DomainError(
        413,
        "FILE_TOO_LARGE",
        "파일은 20 MiB까지 지원합니다.",
      );
    const file = {
      storageKey: this.uuid(),
      fileName: normalizeFileName(name),
      mimeType: detectFileMime(bytes),
      size: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
    // Only a successful exclusive open establishes ownership. An EEXIST target
    // belongs to an earlier version and must never enter the cleanup path.
    const fd = openSync(this.keyPath(file.storageKey), "wx", 0o600);
    try {
      writeFileSync(fd, bytes);
      closeSync(fd);
    } catch (error) {
      try {
        closeSync(fd);
      } catch {
        /* Keep the original write/close failure. */
      }
      this.discard(file.storageKey);
      throw error;
    }
    return file;
  }
  filePath(key: string): string {
    const path = this.keyPath(key);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      throw new DomainError(
        404,
        "FILE_MISSING",
        "저장 파일을 찾을 수 없습니다.",
      );
    }
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new DomainError(
        404,
        "FILE_MISSING",
        "저장 파일을 찾을 수 없습니다.",
      );
    return path;
  }
  remove(key: string) {
    try {
      unlinkSync(this.keyPath(key));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
  }
  private discard(key: string) {
    try {
      this.remove(key);
    } catch {
      console.error(
        "A new upload could not be cleaned up; check storage permissions.",
      );
    }
  }
  withUpload<T>(
    bytes: Buffer,
    name: string,
    commit: (file: StoredFile) => { storageKey: string; value: T },
  ): T {
    const file = this.write(bytes, name);
    try {
      const receipt = commit(file);
      if (receipt.storageKey !== file.storageKey) this.discard(file.storageKey);
      return receipt.value;
    } catch (error) {
      this.discard(file.storageKey);
      throw error;
    }
  }
}
