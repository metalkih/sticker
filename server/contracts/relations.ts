import { z } from "zod";
import { STATUSES } from "../types.js";
const id = z.string().min(1).max(128);
const revision = z.number().int().positive();
export const relationKindSchema = z.enum(["parent", "blocks", "related"]);
export const relationInputSchema = z
  .object({
    kind: relationKindSchema,
    targetIssueId: id,
    sourceRevision: revision,
    targetRevision: revision,
  })
  .strict();
export const relationRevisionSchema = z
  .object({ sourceRevision: revision, targetRevision: revision })
  .strict();
export const relationSchema = z
  .object({
    id,
    projectId: id,
    kind: relationKindSchema,
    sourceIssueId: id,
    targetIssueId: id,
    createdBy: id,
    createdAt: z.string(),
  })
  .strict();
export const relatedIssueSchema = z.object({
  id,
  projectId: id,
  key: z.string(),
  title: z.string(),
  status: z.enum(STATUSES),
  revision,
});
export const relationEntrySchema = z.object({
  relation: relationSchema,
  issue: relatedIssueSchema,
});
export const childCountsSchema = z.object({
  backlog: z.number(),
  ready: z.number(),
  in_progress: z.number(),
  waiting: z.number(),
  done: z.number(),
  closed: z.number(),
});
export const relationSummarySchema = z.object({
  blocked: z.boolean(),
  blockers: relatedIssueSchema.array(),
  childCounts: childCountsSchema,
});
export const relationSummariesSchema = z.record(
  z.string(),
  relationSummarySchema,
);
export const relationDetailSchema = relationSummarySchema.extend({
  parent: relationEntrySchema.nullable(),
  children: relationEntrySchema.array(),
  related: relationEntrySchema.array(),
  blockerRelations: relationEntrySchema.array(),
  blocking: relationEntrySchema.array(),
});
export type IssueRelation = z.infer<typeof relationSchema>;
export type RelatedIssue = z.infer<typeof relatedIssueSchema>;
export type RelationSummary = z.infer<typeof relationSummarySchema>;
export type RelationDetail = z.infer<typeof relationDetailSchema>;
