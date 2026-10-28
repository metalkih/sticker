import { z } from "zod";
const id = z.string().trim().min(1).max(128);
// Canonical millisecond precision makes TEXT ordering match chronological ordering.
const stamp = z.iso
  .datetime()
  .transform((value) => new Date(value).toISOString());
const message = z.string().trim().min(1).max(20000);
const base = {
  projectId: id,
  issueId: id.nullable().default(null),
  externalSessionId: id,
  eventId: id,
  occurredAt: stamp.optional(),
  message,
};
export const sessionEventInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...base,
      kind: z.literal("report"),
      state: z.enum(["working", "idle", "blocked"]).default("working"),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("request"),
      requestKind: z.enum(["input", "review"]),
    })
    .strict(),
  z.object({ ...base, kind: z.literal("result") }).strict(),
  z.object({ ...base, kind: z.literal("error") }).strict(),
  z.object({ ...base, kind: z.literal("end") }).strict(),
]);
export const sessionSchema = z
  .object({
    id,
    externalSessionId: id,
    agentId: id,
    agentName: z.string(),
    lastMessage: z.string(),
    projectId: id,
    issueId: id.nullable(),
    startedAt: stamp,
    lastReportedAt: stamp,
    endedAt: stamp.nullable(),
    closedAt: stamp.nullable(),
    revision: z.number().int().positive(),
    legacy: z.boolean(),
    state: z.enum([
      "working",
      "idle",
      "blocked",
      "recorded",
      "input",
      "review",
      "ended",
      "closed",
      "stale",
    ]),
    stale: z.boolean(),
    pendingInput: z.number().int().nonnegative(),
    pendingReview: z.number().int().nonnegative(),
  })
  .strict();
export const sessionEventSchema = z
  .object({
    sessionId: id,
    eventId: id,
    kind: z.enum(["report", "request", "result", "error", "end"]),
    occurredAt: stamp,
    receivedAt: stamp,
    message: z.string(),
    payload: z
      .object({
        state: z.enum(["working", "idle", "blocked"]).optional(),
        requestKind: z.enum(["input", "review"]).optional(),
      })
      .strict(),
  })
  .strict();
export const sessionRequestSchema = z
  .object({
    id,
    sessionId: id,
    eventId: id,
    kind: z.enum(["input", "review"]),
    prompt: z.string(),
    createdAt: stamp,
    revision: z.number().int().positive(),
    status: z.enum(["pending", "answered", "closed"]),
    response: z.string().nullable(),
    respondedAt: stamp.nullable(),
    projectId: id,
    issueId: id.nullable(),
    agentName: z.string(),
    externalSessionId: id,
  })
  .strict();
export const sessionDetailSchema = z
  .object({
    session: sessionSchema,
    events: sessionEventSchema.array(),
    requests: sessionRequestSchema.array(),
  })
  .strict();
export const sessionEventResultSchema = z
  .object({
    session: sessionSchema,
    event: sessionEventSchema,
    request: sessionRequestSchema.nullable(),
  })
  .strict();
export const responseInputSchema = z
  .object({
    revision: z.number().int().positive(),
    operationId: z.uuid(),
    body: message,
  })
  .strict();
export const closeInputSchema = responseInputSchema.omit({ body: true });
export type AgentSession = z.infer<typeof sessionSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type SessionRequest = z.infer<typeof sessionRequestSchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
