import {
  bootstrapSchema,
  sessionDetailSchema,
} from "../../server/response-schemas.js";
import { test, expect } from "@playwright/test";
const password =
  process.env.STICKER_TEST_PASSWORD || "ephemeral-sticker-test-password";
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === "iphone")
    await page.setViewportSize({ width: 375, height: 812 });
});
async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("소유자 비밀번호").fill(password);
  await page.getByRole("button", { name: "작업 공간 열기" }).click();
}
test("sessions remain separate, keyboard detail direct-route refresh/back and long text fit mobile", async ({
  page,
}, testInfo) => {
  await login(page);
  await page
    .getByRole("button", { name: "에이전트 기록", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /세션 fixture-parallel-a 상세/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /세션 fixture-parallel-b 상세/ }),
  ).toBeVisible();
  const card = page.getByRole("button", {
    name: /세션 fixture-parallel-a 상세/,
  });
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "에이전트 세션 상세" }),
  ).toBeVisible();
  const timeline = page.getByRole("list", { name: "이벤트 타임라인" });
  await expect(timeline.locator(":scope > li > code")).toHaveText([
    "eventId: start",
    "eventId: long-result",
    "eventId: input",
  ]);
  await expect(timeline).toContainText("서버 수신:");
  const hash = new URL(page.url()).hash;
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "에이전트 세션 상세" }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe(hash);
  expect(
    await page
      .getByRole("dialog", { name: "에이전트 세션 상세" })
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await testInfo.attach("session-detail", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const sessionId = new URLSearchParams(new URL(page.url()).hash.slice(1)).get(
    "session",
  );
  if (!sessionId) throw new Error("Missing selected session route");
  const detailResponse = await page.request.get(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  const rawDetail: unknown = await detailResponse.json(),
    detail = sessionDetailSchema.parse(rawDetail);
  const pendingRequest = detail.requests.find(
    (request) => request.status === "pending" && request.kind === "input",
  );
  if (!pendingRequest) throw new Error("Missing fixture pending input request");
  const action = page
    .getByRole("region", { name: "미처리 요청" })
    .getByRole("button", {
      name: `입력 요청 ${pendingRequest.id} 확인`,
      exact: true,
    });
  await expect(action).toHaveAccessibleDescription(pendingRequest.prompt);
  await expect(action).toBeInViewport({ ratio: 1 });
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "요청 확인" })).toBeVisible();
  expect(
    new URLSearchParams(new URL(page.url()).hash.slice(1)).get("request"),
  ).toBe(pendingRequest.id);
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "에이전트 세션 상세" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "창 닫기", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "에이전트 세션 상세" }),
  ).toBeVisible();
});
test("inbox exact-request reply, completed state, error draft retention and focus return", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "사용자 확인함", exact: true })
    .click();
  const bootstrapResponse = await page.request.get("/api/bootstrap");
  const raw: unknown = await bootstrapResponse.json(),
    data = bootstrapSchema.parse(raw);
  const project = data.projects.find((p) => p.key === "SESS");
  if (!project) throw new Error("Missing disposable session fixture project");
  const issue = data.issues.find((i) => i.projectId === project.id);
  if (!issue) throw new Error("Missing disposable session fixture issue");
  const unique = `fixture-input-${crypto.randomUUID()}`;
  const created = await page.request.post("/api/sessions/events", {
    headers: { authorization: "Bearer disposable-browser-session-agent-token" },
    data: {
      projectId: project.id,
      issueId: issue.id,
      externalSessionId: unique,
      eventId: "input",
      kind: "request",
      requestKind: "input",
      message: unique,
    },
  });
  expect(created.status()).toBe(201);
  await page
    .getByRole("button", { name: "확인함 새로고침", exact: true })
    .click();
  const request = page.getByRole("button", {
    name: `요청 ${unique} 확인`,
    exact: true,
  });
  await request.click();
  await expect(page.getByRole("dialog", { name: "요청 확인" })).toBeVisible();
  await page.getByLabel("답변").fill("검토만 기록하고 자동 실행하지 마세요.");
  await page.route("**/api/requests/*/responses", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        code: "REVISION_CONFLICT",
        error: "다른 창에서 처리되었습니다.",
      }),
    }),
  );
  await page.getByRole("button", { name: "답변 기록", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("다른 창");
  await expect(page.getByLabel("답변")).toHaveValue(
    "검토만 기록하고 자동 실행하지 마세요.",
  );
  await page.unroute("**/api/requests/*/responses");
  await page.getByRole("button", { name: "답변 기록", exact: true }).click();
  await expect(
    page.getByText("처리 완료: 답변 기록됨", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "창 닫기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "처리 완료 보기", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "처리 완료 보기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `요청 ${unique} 확인`, exact: true }),
  ).toBeVisible();
});
test("session refresh failure retains last successful timestamp and project filter empty state", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "에이전트 기록", exact: true })
    .click();
  await expect(
    page.getByText("마지막 확인:", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /세션 fixture-parallel-a 상세/ }),
  ).toBeVisible();
  await page.route("**/api/sessions", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "조회 실패" }),
    }),
  );
  await page
    .getByRole("button", { name: "세션 새로고침", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("조회 실패");
  await expect(
    page.getByRole("button", { name: /세션 fixture-parallel-a 상세/ }),
  ).toBeVisible();
  await expect(
    page.getByText("마지막 확인:", { exact: false }).first(),
  ).toBeVisible();
  await page.unroute("**/api/sessions");
  await page
    .getByLabel("세션 프로젝트 필터")
    .selectOption({ label: "빈 세션 프로젝트" });
  await expect(
    page.getByText("아직 전달된 세션이 없어요", { exact: true }),
  ).toBeVisible();
});
