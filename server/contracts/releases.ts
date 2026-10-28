import { z } from "zod";
import { issueSchema, versionSchema } from "../response-schemas.js";
const id = z.string().min(1).max(128),
  revision = z.number().int().positive();
const selected = z
  .array(id)
  .max(200)
  .refine(
    (v) => new Set(v).size === v.length,
    "중복 이슈를 선택할 수 없습니다.",
  );
export const carryoverInputSchema = z
  .object({
    revision,
    destinationVersionId: id,
    destinationRevision: revision,
    operationId: z.uuid(),
    issues: z
      .array(z.object({ issueId: id, revision }).strict())
      .min(1)
      .max(200),
  })
  .strict()
  .refine(
    (v) => new Set(v.issues.map((x) => x.issueId)).size === v.issues.length,
    "중복 이슈를 선택할 수 없습니다.",
  );
export const carryoverItemSchema = z.object({
  issueId: id,
  outcome: z.enum(["moved", "conflict", "failed"]),
  code: z.string().nullable(),
  issue: issueSchema.nullable(),
});
export const carryoverResultSchema = z.object({
  items: carryoverItemSchema.array(),
});
export const carryoverPreviewSchema = z.object({
  items: z.array(
    z.object({
      issue: issueSchema,
      blocked: z.boolean(),
      outcome: z.enum(["ready", "conflict", "denied"]),
    }),
  ),
});
export const changelogInputSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    selectedIssueIds: selected,
    markdown: z.string().max(100000),
  })
  .strict();
export const generateChangelogInputSchema = changelogInputSchema.omit({
  markdown: true,
});
export const changelogSchema = z.object({
  versionId: id,
  markdown: z.string(),
  selectedIssueIds: selected,
  revision: z.number().int().nonnegative(),
  authorId: z.string().nullable(),
  authorName: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export const releaseInputSchema = z
  .object({
    revision,
    operationId: z.uuid(),
    confirm: z.literal(true),
    state: z.enum(["released", "planned", "archived"]).default("released"),
  })
  .strict();
export const releaseAuditSchema = z.object({
  id,
  versionId: id,
  authorId: id,
  authorName: z.string(),
  fromState: z.enum(["planned", "released", "archived"]),
  toState: z.enum(["planned", "released", "archived"]),
  reviewedRevision: revision,
  operationId: z.uuid(),
  createdAt: z.string(),
});
export const releaseResultSchema = z.object({
  version: versionSchema,
  audit: releaseAuditSchema,
});
export const readinessSchema = z.object({
  version: versionSchema,
  targetIssues: issueSchema.array(),
  foundIssues: issueSchema.array(),
  fixedIssues: issueSchema.array(),
  counts: z.object({
    unfinished: z.number(),
    done: z.number(),
    closed: z.number(),
    blocked: z.number(),
    total: z.number(),
  }),
  blockedIssueIds: id.array(),
  releaseHistory: releaseAuditSchema.array(),
});
export type VersionReadiness = z.infer<typeof readinessSchema>;
export type Changelog = z.infer<typeof changelogSchema>;
export type CarryoverInput = z.infer<typeof carryoverInputSchema>;
export type CarryoverResult = z.infer<typeof carryoverResultSchema>;
export type CarryoverPreview = z.infer<typeof carryoverPreviewSchema>;
export type ReleaseResult = z.infer<typeof releaseResultSchema>;
