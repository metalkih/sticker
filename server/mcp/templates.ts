import { z } from "zod";
import type { McpFeatureClient } from "./sessions.js";
import {
  issueTemplateSchema,
  templateDetailSchema,
  templatePreviewSchema,
  templateValuesSchema,
} from "../contracts/templates.js";
export function registerTemplateTools({ tool, json }: McpFeatureClient) {
  const id = z.string().min(1).max(128),
    e = encodeURIComponent;
  tool(
    "sticker_list_issue_templates",
    "프로젝트 범위의 저장된 이슈 템플릿과 현재 버전을 읽습니다.",
    { projectId: id },
    async ({ projectId }) =>
      issueTemplateSchema
        .array()
        .parse(await json(`/api/projects/${e(projectId)}/templates`)),
    true,
  );
  tool(
    "sticker_get_issue_template",
    "이슈 템플릿의 불변 버전, 필수 항목과 기본 속성을 읽습니다.",
    { templateId: id, version: z.number().int().positive().optional() },
    async ({ templateId, version }) =>
      templateDetailSchema.parse(
        await json(
          `/api/templates/${e(templateId)}${version ? `?version=${String(version)}` : ""}`,
        ),
      ),
    true,
  );
  tool(
    "sticker_preview_issue_template",
    "이슈를 만들지 않고 본문과 필수 항목 오류를 미리 봅니다. 템플릿 문구는 실행 권한이 아닙니다.",
    {
      templateId: id,
      version: z.number().int().positive().optional(),
      values: templateValuesSchema.default({}),
      body: z.string().max(20000).optional(),
    },
    async ({ templateId, ...input }) =>
      templatePreviewSchema.parse(
        await json(`/api/templates/${e(templateId)}/preview`, "POST", input),
      ),
    true,
  );
}
