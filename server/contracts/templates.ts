import { z } from "zod";
export const TEMPLATE_FIELDS = [
  "reproduction",
  "expected",
  "actual",
  "foundVersionId",
  "problem",
  "scope",
  "acceptance",
  "input",
  "constraints",
  "verification",
] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];
export const templateFieldLabels: Record<TemplateField, string> = {
  reproduction: "재현 절차",
  expected: "기대 결과",
  actual: "실제 결과",
  foundVersionId: "발견 버전",
  problem: "문제",
  scope: "범위",
  acceptance: "완료 기준",
  input: "입력",
  constraints: "제약",
  verification: "검증",
};
const id = z.string().min(1).max(128),
  stamp = z.iso.datetime();
export const templateDefaultsSchema = z
  .object({
    status: z
      .enum(["backlog", "ready", "in_progress", "waiting", "done"])
      .optional(),
    priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional(),
    assignee: z.string().trim().max(80).optional(),
    targetVersionId: id.nullable().optional(),
    foundVersionId: id.nullable().optional(),
    fixedVersionId: id.nullable().optional(),
    labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .strict();
export const requiredTemplateFieldsSchema = z
  .array(z.enum(TEMPLATE_FIELDS))
  .max(TEMPLATE_FIELDS.length)
  .refine(
    (values) => new Set(values).size === values.length,
    "필수 항목이 중복되었습니다.",
  );
export const templateValuesSchema = z.partialRecord(
  z.enum(TEMPLATE_FIELDS),
  z.string().trim().max(8000),
);
export const templateDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    body: z.string().max(20000),
    requiredFields: requiredTemplateFieldsSchema,
    defaults: templateDefaultsSchema,
  })
  .strict();
export const templateCreateSchema = templateDefinitionSchema
  .extend({ projectId: id, operationId: z.uuid() })
  .strict();
export const templateUpdateSchema = templateDefinitionSchema
  .extend({ revision: z.number().int().positive() })
  .strict();
export const templateDeleteSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();
export const issueTemplateSchema = z
  .object({
    id,
    projectId: id,
    name: z.string().trim().min(1).max(120),
    currentVersion: z.number().int().positive(),
    revision: z.number().int().positive(),
    deletedAt: stamp.nullable(),
    createdAt: stamp,
    updatedAt: stamp,
  })
  .strict();
export const templateVersionSchema = z
  .object({
    templateId: id,
    version: z.number().int().positive(),
    body: z.string().max(20000),
    requiredFields: requiredTemplateFieldsSchema,
    defaults: templateDefaultsSchema,
    authorId: id,
    authorName: z.string(),
    createdAt: stamp,
  })
  .strict();
export const templateDetailSchema = z
  .object({
    template: issueTemplateSchema,
    versions: templateVersionSchema.array(),
    selectedVersion: templateVersionSchema,
  })
  .strict();
export const templateAssigneeSchema = z
  .object({ id, name: z.string(), role: z.enum(["owner", "agent"]) })
  .strict();
export const templateExampleSchema = templateDefinitionSchema
  .extend({ exampleId: z.enum(["bug", "feature", "agent"]) })
  .strict();
export const TEMPLATE_EXAMPLES: z.infer<typeof templateExampleSchema>[] = [
  {
    exampleId: "bug",
    name: "버그",
    body: "## 버그",
    requiredFields: ["reproduction", "expected", "actual", "foundVersionId"],
    defaults: { priority: "medium" },
  },
  {
    exampleId: "feature",
    name: "기능",
    body: "## 기능",
    requiredFields: ["problem", "scope", "acceptance"],
    defaults: { priority: "medium" },
  },
  {
    exampleId: "agent",
    name: "에이전트 작업",
    body: "## 에이전트 작업",
    requiredFields: ["input", "constraints", "verification"],
    defaults: { status: "backlog" },
  },
];
export function validateTemplateValues(
  requiredFields: readonly TemplateField[],
  values: Partial<Record<TemplateField, string>>,
): Partial<Record<TemplateField, string>> {
  const errors: Partial<Record<TemplateField, string>> = {};
  for (const field of requiredFields)
    if (!values[field]?.trim())
      errors[field] = `${templateFieldLabels[field]}: 필수 항목입니다.`;
  return errors;
}
export function renderTemplate(
  body: string,
  values: Partial<Record<TemplateField, string>>,
  foundVersionName?: string,
): string {
  const sections = TEMPLATE_FIELDS.filter((field) => values[field]?.trim()).map(
    (field) => {
      const value =
        field === "foundVersionId"
          ? (foundVersionName ?? values[field] ?? "")
          : (values[field] ?? "");
      return `## ${templateFieldLabels[field]}\n${value.trim()}`;
    },
  );
  return [body.trim(), ...sections].filter(Boolean).join("\n\n");
}
export type IssueTemplate = z.infer<typeof issueTemplateSchema>;
export type TemplateVersion = z.infer<typeof templateVersionSchema>;
export type TemplateDetail = z.infer<typeof templateDetailSchema>;
export type TemplateDefaults = z.infer<typeof templateDefaultsSchema>;
export type TemplateValues = z.infer<typeof templateValuesSchema>;
export const templateCreateHints = {
  templateId: id.optional(),
  templateVersion: z.number().int().positive().optional(),
  templateValues: templateValuesSchema.optional(),
  operationId: z.uuid().optional(),
};
export const templatePreviewInputSchema = z
  .object({
    version: z.number().int().positive().optional(),
    values: templateValuesSchema.default({}),
    body: z.string().max(20000).optional(),
  })
  .strict();
export const templatePreviewSchema = z
  .object({
    templateId: id,
    templateVersion: z.number().int().positive(),
    description: z.string(),
    errors: z.partialRecord(z.enum(TEMPLATE_FIELDS), z.string()),
    defaults: templateDefaultsSchema,
  })
  .strict();
