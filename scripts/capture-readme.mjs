/** README screenshots from the real app with disposable, fictional data only. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createApp } from "../dist/server/app.js";

const directory = mkdtempSync(join(tmpdir(), "sticker-readme-fixture-"));
const output = resolve("docs/screenshots");
mkdirSync(output, { recursive: true });
const port = 8791;
const password = "temporary-readme-fixture-only";
const app = createApp({
  dataDir: directory,
  ownerPassword: password,
  appOrigin: `http://127.0.0.1:${port}`,
  clientDir: "dist/client",
});
const owner = {
  id: "owner",
  name: "나",
  role: "owner",
  canWrite: true,
  projectIds: null,
};
const project = app.store.createProject(owner, {
  key: "NOTE",
  name: "메모 앱 · 예시",
  color: "#d6ed61",
  description:
    "생각을 빠르게 붙이고 다시 찾는 개인 메모 앱. README 촬영용 가상 프로젝트입니다.",
});
app.store.createProject(owner, {
  key: "CAM",
  name: "사진 일기 · 예시",
  color: "#b8d9fa",
  description: "사진과 한 줄 기록을 모으는 가상의 앱 프로젝트.",
});
const oldVersion = app.store.createVersion(owner, {
  projectId: project.id,
  name: "v0.1 · 첫 메모",
  state: "released",
  description: "메모 작성과 목록의 기본 흐름",
  dueDate: "2026-10-20",
});
const version = app.store.createVersion(owner, {
  projectId: project.id,
  name: "v0.2 · 더 쉽게 찾기",
  state: "planned",
  description: "검색과 보관 흐름을 다듬는 다음 버전",
  dueDate: "2026-11-06",
});
app.store.createVersion(owner, {
  projectId: project.id,
  name: "v0.3 · 함께 정리",
  state: "planned",
  description: "태그와 공유 방식 검토",
});
const definitions = [
  ["태그 색상 규칙 정리", "backlog", "low", "나", ["기획"]],
  ["검색 결과 빈 화면 안내", "ready", "medium", "Codex · UI", ["사용성"]],
  [
    "빠른 검색 입력 흐름 구현",
    "in_progress",
    "high",
    "Codex · 개발",
    ["검색", "v0.2"],
  ],
  ["오프라인 보관 충돌 기준 확인", "waiting", "high", "나", ["결정 필요"]],
  ["긴 메모 제목 줄바꿈 개선", "done", "medium", "Codex · UI", ["검토 대기"]],
  ["메모 작성 후 저장 흐름 검증", "closed", "medium", "나", ["검증"]],
  ["키보드로 메모 빠르게 열기", "ready", "low", "Codex · 개발", ["접근성"]],
  ["검색어 강조 표시 다듬기", "in_progress", "medium", "Codex · UI", ["검색"]],
];
const issues = definitions.map(([title, status, priority, assignee, labels]) =>
  app.store.createIssue(owner, {
    projectId: project.id,
    title,
    status,
    priority,
    assignee,
    labels,
    targetVersionId: version.id,
    description:
      "README 촬영용 예시 이슈입니다. 실제 사용자 작업이나 실행 결과가 아닙니다.\n\n목표\n검색한 메모를 빠르게 찾고, 입력을 취소해도 맥락을 잃지 않게 합니다.\n\n확인할 내용\n• 빈 결과와 긴 제목을 확인합니다.\n• 키보드와 작은 화면에서도 사용할 수 있어야 합니다.",
  }),
);
const detail = app.store.updateIssue(owner, issues[4].id, {
  revision: issues[4].revision,
  foundVersionId: oldVersion.id,
  fixedVersionId: version.id,
});
app.store.addComment(owner, detail.id, {
  body: "예시 검토 메모: 긴 제목과 작은 화면에서 줄바꿈을 확인해주세요. 구현 완료와 사용자 종결은 별도로 관리합니다.",
});
app.store.addAttachment(owner, detail.id, {
  kind: "link",
  name: "예시 검증 문서",
  url: "https://example.com/sticker-demo",
});
const agent = {
  id: "demo-agent",
  name: "Codex · 개발 (예시)",
  role: "agent",
  canWrite: true,
  projectIds: [project.id],
};
app.store.reportAgent(agent, {
  projectId: project.id,
  issueId: issues[2].id,
  state: "working",
  message:
    "촬영용 가상 자기 보고: 검색 입력과 취소 흐름을 확인하는 예시입니다. 실제 에이전트를 실행하지 않았습니다.",
});
const server = await new Promise((resolveServer, reject) => {
  const s = app.app.listen(port, "127.0.0.1", () => resolveServer(s));
  s.on("error", reject);
});
let browser;
try {
  if (process.argv.includes("--seed-check")) {
    assert.equal(app.store.bootstrap(owner).issues.length, 8);
    assert.equal(app.store.getIssue(owner, detail.id).attachments.length, 1);
    console.log("Disposable screenshot fixture verified.");
  } else {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1050 },
      deviceScaleFactor: 1,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByLabel("소유자 비밀번호").fill(password);
    await page.getByRole("button", { name: "작업 공간 열기" }).click();
    await page
      .getByRole("heading", { name: "내 작업 공간", exact: true })
      .waitFor();
    await page.evaluate("document.fonts.ready");
    await page.screenshot({
      path: join(output, "main-board.png"),
      animations: "disabled",
    });
    await page.goto(`http://127.0.0.1:${port}/#issue=${detail.id}`);
    await page
      .getByRole("heading", { name: detail.title, exact: true, level: 2 })
      .waitFor();
    await page.getByText("예시 검증 문서", { exact: true }).waitFor();
    await page.screenshot({
      path: join(output, "issue-review.png"),
      animations: "disabled",
    });
    await page.goto(`http://127.0.0.1:${port}/#section=versions`);
    await page
      .getByRole("heading", { name: "버전과 릴리스", exact: true })
      .waitFor();
    await page.getByText("v0.2 · 더 쉽게 찾기", { exact: true }).waitFor();
    await page.screenshot({
      path: join(output, "version-planning.png"),
      animations: "disabled",
    });
    await page.goto(`http://127.0.0.1:${port}/#section=agents`);
    await page
      .getByRole("heading", { name: "에이전트 기록", exact: true })
      .waitFor();
    await page.getByText("Codex · 개발 (예시)", { exact: true }).waitFor();
    await page.screenshot({
      path: join(output, "agent-report.png"),
      animations: "disabled",
    });
    assert.deepEqual(
      errors,
      [],
      "No browser runtime errors during screenshot flows",
    );
    console.log(
      "Captured four real Sticker screens with disposable fictional data.",
    );
  }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  app.close();
  rmSync(directory, { recursive: true, force: true });
}
