import { z } from "zod";
import { issueQuerySchema } from "./issue-query.js";
import { issueSchema } from "../response-schemas.js";
const id = z.string().min(1).max(128),
  name = z.string().trim().min(1).max(80),
  revision = z.number().int().positive();
export const savedQuerySchema = issueQuerySchema.extend({ projectId: id });
export const viewCreateSchema = z
  .object({ name, query: savedQuerySchema })
  .strict();
export const viewUpdateSchema = viewCreateSchema.extend({ revision });
export const viewDeleteSchema = z.object({ revision }).strict();
export const savedViewSchema = z.object({
  id,
  actorId: id,
  projectId: id,
  name,
  query: savedQuerySchema,
  revision,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const viewPreferencesSchema = z.object({
  projectId: id,
  revision: z.number().int().nonnegative(),
  defaultViewId: id.nullable(),
  favoriteIds: z.array(id).max(100),
});
export const viewPreferenceInputSchema = viewPreferencesSchema
  .omit({ projectId: true })
  .strict()
  .refine(
    (p) => new Set(p.favoriteIds).size === p.favoriteIds.length,
    "즐겨찾기가 중복되었습니다.",
  );
export const queryWarningSchema = z.object({
  code: z.enum([
    "PROJECT_MISSING",
    "VERSION_MISSING",
    "VERSION_PROJECT_MISMATCH",
  ]),
  field: z.string(),
  message: z.string(),
});
export const issueQueryResultSchema = z.object({
  issues: issueSchema.array(),
  warnings: queryWarningSchema.array(),
});
export type SavedView = z.infer<typeof savedViewSchema>;
export type ViewPreferences = z.infer<typeof viewPreferencesSchema>;
export type QueryWarning = z.infer<typeof queryWarningSchema>;
