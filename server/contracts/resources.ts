import { z } from "zod";
const id = z.string().min(1).max(128),
  resourceId = z.uuid(),
  revision = z.number().int().positive();
export const MAX_RESOURCE_FILE_BYTES = 20 * 1024 * 1024;
export const resourceKindSchema = z.enum(["markdown", "file", "link"]);
export const resourceUrlSchema = z
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, "인증정보 없는 http/https 링크만 사용할 수 있습니다.");
const title = z.string().trim().min(1).max(255),
  markdown = z.string().max(100000),
  operationId = z.uuid();
const scope = {
  projectId: id,
  versionId: id.nullable().optional().default(null),
  title,
  operationId,
};
export const resourceCreateInputSchema = z.discriminatedUnion("kind", [
  z.object({ ...scope, kind: z.literal("markdown"), markdown }).strict(),
  z
    .object({ ...scope, kind: z.literal("link"), url: resourceUrlSchema })
    .strict(),
]);
export const resourceUploadInputSchema = z.object(scope).strict();
export const resourcePatchInputSchema = z
  .object({
    revision,
    operationId,
    title: title.optional(),
    versionId: id.nullable().optional(),
    markdown: markdown.optional(),
    url: resourceUrlSchema.optional(),
  })
  .strict()
  .refine(
    (value) => !(value.markdown !== undefined && value.url !== undefined),
    "문서와 링크 내용을 함께 보낼 수 없습니다.",
  );
export const resourceMutationInputSchema = z
  .object({ revision, operationId })
  .strict();
export const resourceGuidanceInputSchema = resourceMutationInputSchema
  .extend({ isGuidance: z.boolean() })
  .strict();
export const resourceLinkInputSchema = z
  .object({
    resourceId,
    resourceVersion: revision.optional(),
    issueRevision: revision,
    operationId,
  })
  .strict();
export const resourceUnlinkInputSchema = z
  .object({ issueRevision: revision, operationId })
  .strict();
export const resourceReferenceInputSchema = z
  .object({
    sessionId: id,
    eventId: id,
    resourceId,
    resourceVersion: revision,
    operationId,
  })
  .strict();
export const resourceQuerySchema = z
  .object({
    projectId: id.optional(),
    versionId: id.nullable().optional(),
    kind: resourceKindSchema.optional(),
    query: z.string().trim().max(200).optional(),
  })
  .strict();
export const resourceSchema = z
  .object({
    id: resourceId,
    projectId: id,
    versionId: id.nullable(),
    versionAvailable: z.boolean(),
    kind: resourceKindSchema,
    title,
    currentVersion: revision,
    revision,
    isGuidance: z.boolean(),
    guidanceBy: z.string().nullable(),
    guidanceAt: z.string().nullable(),
    deletedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
const versionBase = {
  resourceId,
  version: revision,
  title,
  authorId: id,
  authorName: z.string(),
  createdAt: z.string(),
};
export const resourceVersionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...versionBase,
      kind: z.literal("markdown"),
      markdown: z.string(),
      url: z.null(),
      fileName: z.null(),
      mimeType: z.null(),
      size: z.literal(0),
      checksum: z.null(),
    })
    .strict(),
  z
    .object({
      ...versionBase,
      kind: z.literal("link"),
      markdown: z.null(),
      url: resourceUrlSchema,
      fileName: z.null(),
      mimeType: z.null(),
      size: z.literal(0),
      checksum: z.null(),
    })
    .strict(),
  z
    .object({
      ...versionBase,
      kind: z.literal("file"),
      markdown: z.null(),
      url: z.null(),
      fileName: z.string(),
      mimeType: z.string(),
      size: z.number().int().min(0).max(MAX_RESOURCE_FILE_BYTES),
      checksum: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export const resourceVersionSummarySchema = z
  .object({
    ...versionBase,
    kind: resourceKindSchema,
    fileName: z.string().nullable(),
    mimeType: z.string().nullable(),
    size: z.number().int().nonnegative(),
  })
  .strict();
export const resourceUsageSchema = z
  .object({
    issues: z.array(
      z.object({
        issueId: id,
        key: z.string(),
        title: z.string(),
        resourceVersion: revision,
      }),
    ),
    results: z.array(
      z.object({
        sessionId: id,
        eventId: id,
        agentName: z.string(),
        resourceVersion: revision,
      }),
    ),
  })
  .strict();
export const resourceEventSchema = z
  .object({
    id: resourceId,
    resourceId,
    action: z.enum([
      "created",
      "updated",
      "guidance_designated",
      "guidance_removed",
      "deleted",
    ]),
    revision,
    authorId: id,
    authorName: z.string(),
    createdAt: z.string(),
  })
  .strict();
export const resourceDetailSchema = z
  .object({
    resource: resourceSchema,
    current: resourceVersionSchema.nullable(),
    history: resourceVersionSummarySchema.array(),
    events: resourceEventSchema.array(),
    usage: resourceUsageSchema,
  })
  .strict();
export const issueResourceLinkSchema = z
  .object({
    id: resourceId,
    issueId: id,
    resource: resourceSchema,
    version: resourceVersionSchema,
    createdBy: id,
    createdAt: z.string(),
  })
  .strict();
export const resourceReferenceSchema = z
  .object({
    id: resourceId,
    sessionId: id,
    eventId: id,
    resource: resourceSchema,
    version: resourceVersionSchema,
    recordedBy: id,
    createdAt: z.string(),
  })
  .strict();
export type Resource = z.infer<typeof resourceSchema>;
export type ResourceVersion = z.infer<typeof resourceVersionSchema>;
export type ResourceDetail = z.infer<typeof resourceDetailSchema>;
export type ResourceQuery = z.infer<typeof resourceQuerySchema>;
export type ResourceVersionSummary = z.infer<
  typeof resourceVersionSummarySchema
>;
export type ResourceReference = z.infer<typeof resourceReferenceSchema>;
export type IssueResourceLink = z.infer<typeof issueResourceLinkSchema>;
