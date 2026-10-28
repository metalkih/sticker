import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { Actor } from "./types.js";
export interface AgentConfig {
  id: string;
  name: string;
  tokenHash: string;
  projectIds: string[] | null;
  canWrite: boolean;
}
export interface AuthOptions {
  ownerPassword: string;
  agents?: AgentConfig[];
  sessionTtlMs?: number;
}
const agentSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .refine((v) => v !== "owner"),
    name: z.string().trim().min(1).max(80),
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    projectIds: z.array(z.string().min(1).max(100)).max(1000).nullable(),
    canWrite: z.boolean(),
  })
  .strict();
const sha = (v: string) => createHash("sha256").update(v).digest();
const owner: Actor = {
  id: "owner",
  name: "나",
  role: "owner",
  canWrite: true,
  projectIds: null,
};
export class AuthManager {
  private salt = randomBytes(32);
  private passwordHash: Buffer;
  private sessions = new Map<string, number>();
  private failures = new Map<string, { count: number; until: number }>();
  private agents: AgentConfig[];
  private sessionTtlMs: number;
  constructor(options: AuthOptions) {
    if (
      typeof options.ownerPassword !== "string" ||
      options.ownerPassword.length < 12 ||
      options.ownerPassword.length > 1024
    )
      throw new Error(
        "OWNER_PASSWORD must be 12–1024 characters; no default credential is provided.",
      );
    this.agents = z
      .array(agentSchema)
      .max(100)
      .parse(options.agents ?? []);
    if (
      new Set(this.agents.map((a) => a.id)).size !== this.agents.length ||
      new Set(this.agents.map((a) => a.tokenHash)).size !== this.agents.length
    )
      throw new Error("Agent IDs and token hashes must be unique.");
    this.passwordHash = scryptSync(options.ownerPassword, this.salt, 32);
    this.sessionTtlMs = options.sessionTtlMs ?? 12 * 60 * 60 * 1000;
  }
  private cookieToken(cookie?: string) {
    return cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("sticker_session="))
      ?.slice(16);
  }
  authenticate(authorization?: string, cookie?: string): Actor | null {
    if (authorization) {
      if (!authorization.startsWith("Bearer ") || authorization.length > 4096)
        return null;
      const hash = sha(authorization.slice(7));
      const agent = this.agents.find((a) =>
        timingSafeEqual(hash, Buffer.from(a.tokenHash, "hex")),
      );
      return agent
        ? {
            id: agent.id,
            name: agent.name,
            role: "agent",
            canWrite: agent.canWrite,
            projectIds:
              agent.projectIds === null ? null : [...agent.projectIds],
          }
        : null;
    }
    const token = this.cookieToken(cookie);
    if (!token || token.length > 128) return null;
    const key = sha(token).toString("hex");
    const expires = this.sessions.get(key);
    if (!expires) return null;
    if (expires <= Date.now()) {
      this.sessions.delete(key);
      return null;
    }
    return { ...owner };
  }
  login(password: string, ip: string): string | null {
    const now = Date.now();
    for (const [key, value] of this.failures)
      if (value.until <= now) this.failures.delete(key);
    for (const [key, expires] of this.sessions)
      if (expires <= now) this.sessions.delete(key);
    const fail = this.failures.get(ip);
    if (fail && fail.count >= 10) return null;
    if (
      typeof password !== "string" ||
      password.length > 1024 ||
      !timingSafeEqual(scryptSync(password, this.salt, 32), this.passwordHash)
    ) {
      if (this.failures.size > 10000) this.failures.clear();
      this.failures.set(ip, {
        count: (fail?.count ?? 0) + 1,
        until: fail?.until ?? now + 15 * 60 * 1000,
      });
      return null;
    }
    this.failures.delete(ip);
    if (this.sessions.size >= 1000)
      this.sessions.delete(this.sessions.keys().next().value!);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(sha(token).toString("hex"), now + this.sessionTtlMs);
    return token;
  }
  logout(cookie?: string): void {
    const token = this.cookieToken(cookie);
    if (token) this.sessions.delete(sha(token).toString("hex"));
  }
}
