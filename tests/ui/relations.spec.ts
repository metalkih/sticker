import { test, expect } from "@playwright/test";
import { projectSchema, issueSchema } from "../../server/response-schemas.js";
test("relation picker, board blocker links, stale failure and desktop/mobile keyboard navigation", async ({
  page,
  request,
}, testInfo) => {
  // Fixture credentials only. API setup and UI share an ordinary owner cookie.
  const origin = new URL(
    testInfo.project.use.baseURL || "http://127.0.0.1:8788",
  ).origin;
  await request.post("/api/session", {
    data: { password: "ephemeral-sticker-test-password" },
  });
  const response = await request.post("/api/projects", {
    headers: { origin },
    data: {
      key: `R${Date.now().toString().slice(-7)}`,
      name: `관계 ${testInfo.project.name}`,
    },
  });
  const project = projectSchema.parse(await response.json());
  const create = async (title: string) =>
    issueSchema.parse(
      await (
        await request.post("/api/issues", {
          headers: { origin },
          data: { projectId: project.id, title },
        })
      ).json(),
    );
  const a = await create(
      "선행 작업 아주 긴 제목을 좁은 화면에서도 읽을 수 있어야 합니다",
    ),
    b = await create("후속 작업");
  const cookies = await request.storageState();
  await page.context().addCookies(cookies.cookies);
  await page.setViewportSize(
    testInfo.project.name === "iphone"
      ? { width: 375, height: 812 }
      : { width: 1440, height: 960 },
  );
  await page.goto(`/#section=issues&project=${project.id}&issue=${b.id}`);
  await page.getByRole("button", { name: "관계 추가", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "관계 추가", exact: true });
  await picker.getByLabel("관계 종류").selectOption("blockedBy");
  await picker.getByLabel("이슈 검색").fill(a.key);
  await picker.getByRole("button", { name: new RegExp(`${a.key} ·`) }).click();
  await picker.getByRole("button", { name: "연결하기", exact: true }).click();
  await expect(
    page.getByText("차단됨 · 소유자 종결 전", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByPlaceholder("이슈 검색…").fill("후속 작업");
  await expect(
    page.getByRole("button", { name: new RegExp(`차단 원인 ${a.key}`) }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: new RegExp(`차단 원인 ${a.key}`) })
    .click();
  await expect(
    page.getByRole("heading", { name: a.title, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("이슈 검색…")).toHaveValue("후속 작업");
  await page
    .getByRole("button", { name: new RegExp(`차단 원인 ${a.key}`) })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: a.title, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.route("**/api/relations/summary", (route) => route.abort());
  await page.getByRole("button", { name: "작업 공간 새로고침" }).click();
  await expect(page.getByText("이전 정보 · 최신 확인 실패")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "관계 요약 재시도" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`relations-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
