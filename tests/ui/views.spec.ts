import {
  savedViewSchema,
  viewPreferencesSchema,
} from "../../server/contracts/views.js";
import { test, expect } from "@playwright/test";
import { projectSchema, issueSchema } from "../../server/response-schemas.js";
test("private saved views keep filters, favorites, defaults and deep links on desktop and mobile", async ({
  page,
  request,
}, testInfo) => {
  const origin = new URL(
    testInfo.project.use.baseURL || "http://127.0.0.1:8788",
  ).origin;
  await request.post("/api/session", {
    data: { password: "ephemeral-sticker-test-password" },
  });
  const project = projectSchema.parse(
    await (
      await request.post("/api/projects", {
        headers: { origin },
        data: {
          key: `V${Date.now().toString().slice(-7)}`,
          name: `뷰 ${testInfo.project.name}`,
        },
      })
    ).json(),
  );
  const issue = issueSchema.parse(
    await (
      await request.post("/api/issues", {
        headers: { origin },
        data: {
          projectId: project.id,
          title: "저장한 조건에 포함",
          labels: ["swift"],
        },
      })
    ).json(),
  );
  await page.context().addCookies((await request.storageState()).cookies);
  await page.setViewportSize(
    testInfo.project.name === "iphone"
      ? { width: 375, height: 812 }
      : { width: 1440, height: 960 },
  );
  await page.goto(`/#project=${project.id}`);
  await page.getByLabel("이슈 검색", { exact: true }).fill("저장한 조건");
  await expect(
    page.getByRole("heading", { name: issue.title, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "새 뷰 저장", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "새 뷰", exact: true });
  await editor.getByLabel("뷰 이름").fill("내 작업");
  await editor.getByRole("button", { name: "뷰 저장", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page).toHaveURL(/view=/);
  const deepLink = page.url();
  const nav = page.getByRole("navigation", { name: "저장한 뷰" });
  const mobile = testInfo.project.name === "iphone";
  const toggle = nav.getByRole("button", { name: /저장한 뷰 (펼치기|접기)/ });
  if (mobile) {
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.tap();
  }
  await nav
    .getByRole("button", { name: "내 작업 즐겨찾기", exact: true })
    .click();
  await expect(
    nav.getByRole("button", { name: "내 작업 즐겨찾기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const id = new URLSearchParams(new URL(deepLink).hash.slice(1)).get("view");
  if (!id) throw new Error("Saved view link missing ID");
  await nav.getByLabel("기본 뷰").selectOption(id);
  await expect(nav.getByLabel("기본 뷰")).toHaveValue(id);
  const second = savedViewSchema.parse(
    await (
      await request.post("/api/views", {
        headers: { origin },
        data: {
          name: "다른 뷰",
          query: {
            projectId: project.id,
            query: "저장한 조건",
            sort: "key_asc",
            mode: "board",
          },
        },
      })
    ).json(),
  );
  await page.reload();
  if (mobile) await toggle.tap();
  await expect(page.getByLabel("이슈 검색", { exact: true })).toHaveValue(
    "저장한 조건",
  );
  await expect(
    nav.getByRole("button", { name: "내 작업 즐겨찾기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  if (mobile) {
    await nav.getByRole("button", { name: "다른 뷰", exact: true }).tap();
    await expect(page).toHaveURL(new RegExp(`view=${second.id}`));
    await expect(
      page.getByRole("heading", { name: "다른 뷰", exact: true }),
    ).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await toggle.press("Enter");
    await toggle.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.press("Enter");
    await nav
      .getByRole("button", { name: "내 작업 즐겨찾기", exact: true })
      .focus();
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
  }
  await page.getByRole("heading", { name: issue.title, exact: true }).click();
  const detail = page.getByRole("dialog", { name: "이슈 상세", exact: true });
  await expect(detail).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(page.getByLabel("이슈 검색", { exact: true })).toHaveValue(
    "저장한 조건",
  );
  const storedPreferences = viewPreferencesSchema.parse(
    await (await request.get(`/api/view-preferences/${project.id}`)).json(),
  );
  expect(storedPreferences.defaultViewId).toBe(id);
  // A same-project hash change is an explicit ordinary-board selection, not entry.
  await page
    .getByRole("navigation", { name: "작업 공간 메뉴" })
    .getByRole("button", { name: "프로젝트", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "프로젝트", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: project.name, exact: true }),
    })
    .click();
  await expect(page).toHaveURL(/view=/);
  await expect(page.getByLabel("이슈 검색", { exact: true })).toHaveValue(
    "저장한 조건",
  );
  await page.getByRole("button", { name: "뷰 복제", exact: true }).click();
  const copy = page.getByRole("dialog", { name: "뷰 복제", exact: true });
  await expect(copy.getByRole("button", { name: "창 닫기" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(copy).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath(`views-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
