import { test, expect } from "@playwright/test";
import {
  projectSchema,
  versionSchema,
  issueSchema,
} from "../../server/response-schemas.js";
import {
  readinessSchema,
  changelogSchema,
} from "../../server/contracts/releases.js";
test("version roles, partial carryover, Markdown draft, dirty cancellation and explicit owner release work on desktop/mobile", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(60_000);
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
          name: `출시 ${testInfo.project.name}`,
        },
      })
    ).json(),
  );
  const createVersion = async (name: string) =>
    versionSchema.parse(
      await (
        await request.post("/api/versions", {
          headers: { origin },
          data: { projectId: project.id, name },
        })
      ).json(),
    );
  const version = await createVersion("검토 v1"),
    next = await createVersion("다음 v2");
  const createIssue = async (
    title: string,
    status = "backlog",
    target = true,
  ) =>
    issueSchema.parse(
      await (
        await request.post("/api/issues", {
          headers: { origin },
          data: {
            projectId: project.id,
            title,
            status,
            ...(target
              ? {
                  targetVersionId: version.id,
                  foundVersionId: version.id,
                  fixedVersionId: version.id,
                }
              : {}),
          },
        })
      ).json(),
    );
  const a = await createIssue(
      "선택한 변경을 검토하는 아주 긴 한국어 제목을 좁은 화면에서도 확인합니다",
      "waiting",
    ),
    b = await createIssue("병렬 수정 대상", "done"),
    closed = await createIssue("소유자 종결", "closed"),
    blocker = await createIssue("완료 보고된 선행 작업", "done", false);
  expect(
    (
      await request.post(`/api/issues/${blocker.id}/relations`, {
        headers: { origin },
        data: {
          kind: "blocks",
          targetIssueId: a.id,
          sourceRevision: 1,
          targetRevision: 1,
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.context().addCookies((await request.storageState()).cookies);
  await page.setViewportSize(
    testInfo.project.name === "iphone"
      ? { width: 375, height: 812 }
      : { width: 1440, height: 960 },
  );
  await page.goto(`/#version=${version.id}&project=${project.id}`);
  await expect(
    page.getByRole("heading", { name: "검토 v1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "미완료 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "차단 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "소유자 종결 1", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: new RegExp(closed.key + " ·") }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: new RegExp(a.key + " ·") }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "발견 3", exact: true }).click();
  await page
    .getByRole("tab", { name: "발견 3", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "수정 3", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: new RegExp(a.key + " ·") }).click();
  await expect(
    page.getByRole("heading", { name: a.title, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("tab", { name: "수정 3", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "출시 검토", exact: true }).click();
  await expect(page.getByLabel("Markdown 변경로그")).toBeVisible();
  await page
    .getByRole("button", { name: "이관 미리보기", exact: true })
    .click();
  await expect(page.getByText("이관 가능", { exact: true })).toHaveCount(2);
  await request.patch(`/api/issues/${b.id}`, {
    headers: { origin },
    data: { revision: 1, title: "검토 중 다른 수정" },
  });
  await page
    .getByRole("button", { name: "선택 이슈 이관", exact: true })
    .click();
  await expect(page.getByText(/이관 완료/)).toBeVisible();
  await expect(page.getByText(/충돌 · 최신 이슈 확인/)).toBeVisible();
  const detail = (await (
    await request.get(`/api/issues/${a.id}`)
  ).json()) as unknown;
  const moved = issueSchema.parse((detail as { issue: unknown }).issue);
  expect(moved.targetVersionId).toBe(next.id);
  expect(moved.foundVersionId).toBe(version.id);
  expect(moved.fixedVersionId).toBe(version.id);
  expect(moved.status).toBe("waiting");
  const draft = page.getByRole("region", {
    name: "변경로그 초안",
    exact: true,
  });
  await draft.getByLabel(new RegExp(a.key + " ·")).check();
  const generationConfirmation = page
    .waitForEvent("dialog")
    .then(async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toBe("저장하지 않은 변경로그 초안을 바꿀까요?");
      await dialog.accept();
    });
  await draft
    .getByRole("button", { name: "선택 이슈로 초안 생성", exact: true })
    .click();
  await generationConfirmation;
  const generated = changelogSchema.parse(
    await (await request.get(`/api/versions/${version.id}/changelog`)).json(),
  );
  expect(generated.revision).toBe(1);
  expect(generated.selectedIssueIds).toEqual([a.id]);
  await expect(page.getByLabel("Markdown 변경로그")).toHaveValue(
    new RegExp(origin),
  );
  await page
    .getByLabel("Markdown 변경로그")
    .fill("# 사용자가 편집한 출시 초안\n");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByText("저장된 초안 r2", { exact: true })).toBeVisible();
  expect(
    await (
      await request.get(`/api/versions/${version.id}/changelog/export`)
    ).text(),
  ).toBe("# 사용자가 편집한 출시 초안\n");
  const download = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "저장된 Markdown 내보내기", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("changelog.md");
  await page.getByLabel("Markdown 변경로그").fill("버릴 수 없는 미저장 초안");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Markdown 변경로그")).toHaveValue(
    "버릴 수 없는 미저장 초안",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "출시 검토", exact: true }),
  ).toBeFocused();
  expect(
    readinessSchema.parse(
      await (await request.get(`/api/versions/${version.id}/readiness`)).json(),
    ).version.state,
  ).toBe("planned");
  await page.getByRole("button", { name: "출시 검토", exact: true }).click();
  await expect(page.getByLabel("Markdown 변경로그")).toHaveValue(
    "# 사용자가 편집한 출시 초안\n",
  );
  const confirmButton = page.getByRole("button", {
    name: "출시 상태 확정",
    exact: true,
  });
  await expect(confirmButton).toBeDisabled();
  await page.getByLabel(/상태 기록을 확인합니다/).check();
  await confirmButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(
    page.getByText("출시 상태가 기록되었습니다.", { exact: true }),
  ).toBeVisible();
  const final = readinessSchema.parse(
    await (await request.get(`/api/versions/${version.id}/readiness`)).json(),
  );
  expect(final.version.state).toBe("released");
  expect(final.releaseHistory).toHaveLength(1);
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.route(`**/api/versions/${version.id}/readiness`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "출시 조회 실패" }),
    }),
  );
  await page
    .getByRole("button", { name: "버전 상세 새로고침", exact: true })
    .click();
  await expect(page.getByText(/이전 기록/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "검토 v1", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("release-readiness.png"),
    fullPage: true,
  });
});
test("confirmed draft survives failed refresh and dirty browser Back requires discard approval", async ({
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
        data: { key: `D${Date.now().toString().slice(-7)}`, name: "초안 보존" },
      })
    ).json(),
  );
  const version = versionSchema.parse(
    await (
      await request.post("/api/versions", {
        headers: { origin },
        data: { projectId: project.id, name: "보존 버전" },
      })
    ).json(),
  );
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/#section=versions&project=${project.id}`);
  await page
    .getByRole("button", { name: "보존 버전 버전 상세", exact: true })
    .click();
  await page.getByRole("button", { name: "출시 검토", exact: true }).click();
  await expect(page.getByLabel("Markdown 변경로그")).toBeVisible();
  await page.route(`**/api/versions/${version.id}/changelog`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "저장 후 조회 실패" }),
        })
      : route.continue(),
  );
  await page.getByLabel("Markdown 변경로그").fill("# confirmed draft");
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(
    page.getByText("저장 후 조회 실패", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Markdown 변경로그")).toHaveValue(
    "# confirmed draft",
  );
  await expect(page.getByText("서버 초안 r0", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "최신 초안 불러오기", exact: true }),
  ).toHaveCount(0);
  await page.unroute(`**/api/versions/${version.id}/changelog`);
  await page.getByLabel("Markdown 변경로그").fill("# unsaved draft");
  const current = page.url();
  const dismissed = page.waitForEvent("dialog").then(async (dialog) => {
    await dialog.dismiss();
  });
  await page.evaluate(() => {
    history.back();
  });
  await dismissed;
  await expect(page).toHaveURL(current);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Markdown 변경로그")).toHaveValue(
    "# unsaved draft",
  );
  const accepted = page.waitForEvent("dialog").then(async (dialog) => {
    await dialog.accept();
  });
  await page.evaluate(() => {
    history.back();
  });
  await accepted;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "보존 버전 버전 상세", exact: true }),
  ).toBeVisible();
  const stored = (await (
    await request.get(`/api/versions/${version.id}/changelog`)
  ).json()) as unknown;
  expect(changelogSchema.parse(stored).markdown).toBe("# confirmed draft");
});
