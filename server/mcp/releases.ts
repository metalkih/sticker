import { z } from "zod";
import type { McpFeatureClient } from "./sessions.js";
import { readinessSchema, changelogSchema } from "../contracts/releases.js";
export function registerReleaseTools({ tool, json }: McpFeatureClient) {
  const versionId = z.string().min(1).max(128);
  tool(
    "sticker_get_version_readiness",
    "버전의 목표·발견·수정 이슈와 미완료/구현 완료/소유자 종결/차단 집계를 읽습니다.",
    { versionId },
    async (a) =>
      readinessSchema.parse(
        await json(
          `/api/versions/${encodeURIComponent(a.versionId)}/readiness`,
        ),
      ),
    true,
  );
  tool(
    "sticker_get_version_changelog",
    "범위 내 버전의 저장된 Markdown 초안과 선택한 이슈를 읽습니다. 출시/외부 발행하지 않습니다.",
    { versionId },
    async (a) =>
      changelogSchema.parse(
        await json(
          `/api/versions/${encodeURIComponent(a.versionId)}/changelog`,
        ),
      ),
    true,
  );
}
