import { z } from "zod";
import type { McpFeatureClient } from "./sessions.js";
import { issueQuerySchema } from "../contracts/issue-query.js";
import { issueQueryResultSchema, savedViewSchema } from "../contracts/views.js";
import { STATUSES } from "../types.js";
export function registerViewTools({ tool, json }: McpFeatureClient) {
  const id = z.string().min(1).max(128),
    e = encodeURIComponent;
  tool(
    "sticker_query_issues",
    "동일한 프로젝트·버전·관계·입력요청 필터와 정렬로 이슈를 조회합니다. 삭제된 참조는 경고와 빈 결과를 반환합니다.",
    issueQuerySchema.shape,
    async (input) =>
      issueQueryResultSchema.parse(
        await json("/api/issues/query", "POST", input),
      ),
    true,
  );
  tool(
    "sticker_list_issues",
    "권한 내 이슈를 공통 필터로 조회합니다. 단일 status 문자열도 호환합니다.",
    {
      ...issueQuerySchema.shape,
      status: z
        .union([z.enum(STATUSES), issueQuerySchema.shape.status.unwrap()])
        .optional(),
    },
    async (input) =>
      issueQueryResultSchema.parse(
        await json("/api/issues/query", "POST", {
          ...input,
          status:
            typeof input.status === "string" ? [input.status] : input.status,
        }),
      ).issues,
    true,
  );
  tool(
    "sticker_list_saved_views",
    "현재 인증 주체의 개인 저장 뷰만 조회합니다.",
    { projectId: id.optional() },
    async ({ projectId }) =>
      savedViewSchema
        .array()
        .parse(
          await json(
            `/api/views${projectId ? `?projectId=${e(projectId)}` : ""}`,
          ),
        ),
    true,
  );
  tool(
    "sticker_get_saved_view",
    "현재 인증 주체의 개인 뷰 조건을 읽습니다. URL은 권한을 부여하지 않습니다.",
    { viewId: id },
    async ({ viewId }) =>
      savedViewSchema.parse(await json(`/api/views/${e(viewId)}`)),
    true,
  );
}
