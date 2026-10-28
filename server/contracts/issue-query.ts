import { z } from "zod";
import { STATUSES, type Issue } from "../types.js";
const id = z.string().min(1).max(128);
export const issueQuerySchema = z
  .object({
    projectId: id.optional(),
    query: z.string().trim().max(200).optional(),
    status: z.array(z.enum(STATUSES)).min(1).max(6).optional(),
    priority: z
      .array(z.enum(["none", "low", "medium", "high", "urgent"]))
      .min(1)
      .max(5)
      .optional(),
    assignee: z.string().max(160).optional(),
    labels: z.array(z.string().min(1).max(40)).min(1).max(20).optional(),
    targetVersionId: id.nullable().optional(),
    foundVersionId: id.nullable().optional(),
    fixedVersionId: id.nullable().optional(),
    blocked: z.boolean().optional(),
    inputRequested: z.boolean().optional(),
    sort: z
      .enum(["updated_desc", "created_desc", "priority_desc", "key_asc"])
      .default("updated_desc"),
    mode: z.enum(["board", "list"]).default("board"),
  })
  .strict();
export type IssueQuery = z.infer<typeof issueQuerySchema>;
export interface QuerySignals {
  blocked: ReadonlySet<string>;
  inputRequested: ReadonlySet<string>;
}
export function matchesIssue(
  issue: Issue,
  query: IssueQuery,
  signals: QuerySignals,
): boolean {
  return (
    (!query.projectId || issue.projectId === query.projectId) &&
    (!query.query ||
      `${issue.key} ${issue.title} ${issue.description} ${issue.labels.join(" ")}`
        .toLocaleLowerCase("en")
        .includes(query.query.toLocaleLowerCase("en"))) &&
    (!query.status || query.status.includes(issue.status)) &&
    (!query.priority || query.priority.includes(issue.priority)) &&
    (query.assignee === undefined || issue.assignee === query.assignee) &&
    (!query.labels ||
      query.labels.every((label) => issue.labels.includes(label))) &&
    (["targetVersionId", "foundVersionId", "fixedVersionId"] as const).every(
      (field) => query[field] === undefined || issue[field] === query[field],
    ) &&
    (query.blocked === undefined ||
      signals.blocked.has(issue.id) === query.blocked) &&
    (query.inputRequested === undefined ||
      signals.inputRequested.has(issue.id) === query.inputRequested)
  );
}
export function sortIssues(
  issues: readonly Issue[],
  sort: IssueQuery["sort"],
): Issue[] {
  const priority = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };
  return [...issues].sort((a, b) => {
    const value =
      sort === "priority_desc"
        ? priority[b.priority] - priority[a.priority]
        : sort === "updated_desc"
          ? b.updatedAt.localeCompare(a.updatedAt)
          : sort === "created_desc"
            ? b.createdAt.localeCompare(a.createdAt)
            : 0;
    return (
      value ||
      a.key.localeCompare(b.key, "en", { numeric: true }) ||
      a.id.localeCompare(b.id, "en")
    );
  });
}
