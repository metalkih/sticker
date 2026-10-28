import { test, expect } from "@playwright/test";
import { projectSchema, issueSchema } from "../../server/response-schemas.js";
import { resourceDetailSchema } from "../../server/contracts/resources.js";
test("resource document editing preserves dirty drafts, reviews CAS conflicts and renders inert history at desktop/mobile widths", async ({
  page,
  request,
}, info) => {
  const origin = new URL(info.project.use.baseURL || "http://127.0.0.1:8788")
    .origin;
  await request.post("/api/session", {
    data: { password: "ephemeral-sticker-test-password" },
  });
  const project = projectSchema.parse(
    await (
      await request.post("/api/projects", {
        headers: { origin },
        data: {
          key: `D${Date.now().toString().slice(-7)}`,
          name: `자료 문서 ${info.project.name}`,
        },
      })
    ).json(),
  );
  await page.context().addCookies((await request.storageState()).cookies);
  await page.setViewportSize(
    info.project.name === "iphone"
      ? { width: 375, height: 812 }
      : { width: 1440, height: 960 },
  );
  await page.goto(`/#section=resources&project=${project.id}`);
  await expect(page.getByText("자료 없음", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "자료 등록", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "자료 등록", exact: true });
  await editor.getByLabel("자료 제목").fill("공통 설계 문서");
  await editor
    .getByLabel("Markdown 내용")
    .fill(
      '# 최초 설계\n<script>window.resourceExecuted=true</script>\n![외부 이미지](https://example.test/image.png)\n```html\n<svg onload="alert(1)">\n```',
    );
  await editor.getByRole("button", { name: "미리보기", exact: true }).click();
  const preview = editor.getByRole("region", { name: "문서 미리보기" });
  await expect(
    preview.getByRole("heading", { name: "최초 설계" }),
  ).toBeVisible();
  await expect(preview.locator("script,img,svg,iframe")).toHaveCount(0);
  const createdResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/resources") && r.request().method() === "POST",
  );
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  const created = resourceDetailSchema.parse(
    await (await createdResponse).json(),
  );
  await expect(editor).toBeHidden();
  const detail = page.getByRole("region", { name: "자료 상세", exact: true });
  await expect(
    detail.getByRole("heading", { name: "공통 설계 문서", exact: true }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "자료 편집", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "자료 편집", exact: true });
  await edit
    .getByLabel("Markdown 내용")
    .fill("# 보존할 초안\n긴 코드 " + "x".repeat(150));
  page.once("dialog", (dialog) => {
    void dialog.dismiss();
  });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`resource=${created.resource.id}`));
  await expect(edit.getByLabel("Markdown 내용")).toHaveValue(/보존할 초안/);
  const remote = await request.patch(`/api/resources/${created.resource.id}`, {
    headers: { origin },
    data: {
      revision: 1,
      operationId: crypto.randomUUID(),
      markdown: "다른 편집",
    },
  });
  expect(remote.ok()).toBe(true);
  await edit.getByRole("button", { name: "저장", exact: true }).click();
  await expect(edit.getByRole("alert")).toBeVisible();
  await edit
    .getByRole("button", { name: "최신 자료 확인", exact: true })
    .click();
  await expect(edit.getByText("내용 버전 2", { exact: true })).toBeVisible();
  await edit.getByRole("button", { name: "이 버전 기준으로 검토" }).click();
  await expect(edit.getByLabel("Markdown 내용")).toHaveValue(/보존할 초안/);
  await edit.getByRole("button", { name: "저장", exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(
    detail.getByRole("heading", { name: "보존할 초안" }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "지침 지정", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "소유자 지침 지정" });
  await confirmation
    .getByRole("button", { name: "지정하기", exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await expect(
    detail.getByText("소유자 지정 지침", { exact: true }),
  ).toBeVisible();
  await detail.getByLabel("내용 이력").selectOption("1");
  await expect(
    detail.getByRole("heading", { name: "최초 설계", exact: true }),
  ).toBeVisible();
  await page.goto(
    `/#section=resources&project=${project.id}&resource=${created.resource.id}&resourceVersion=2`,
  );
  await expect(detail.getByText("다른 편집", { exact: true })).toBeVisible();
  await expect(detail.getByLabel("내용 이력")).toHaveValue("2");
  await page.goto(
    `/#section=resources&project=${project.id}&resource=${created.resource.id}&resourceVersion=1`,
  );
  await expect(
    detail.getByRole("heading", { name: "최초 설계", exact: true }),
  ).toBeVisible();
  await expect(detail.getByLabel("내용 이력")).toHaveValue("1");
  await expect(detail.locator("script,img,svg,iframe")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: info.outputPath("resource-document-history.png"),
    fullPage: true,
  });
});

test("resource file upload/download stays inert and issue references retain exact versions after unlink", async ({
  page,
  request,
}, info) => {
  const origin = new URL(info.project.use.baseURL || "http://127.0.0.1:8788")
    .origin;
  await request.post("/api/session", {
    data: { password: "ephemeral-sticker-test-password" },
  });
  const project = projectSchema.parse(
    await (
      await request.post("/api/projects", {
        headers: { origin },
        data: {
          key: `F${Date.now().toString().slice(-7)}`,
          name: `자료 파일 ${info.project.name}`,
        },
      })
    ).json(),
  );
  const issue = issueSchema.parse(
    await (
      await request.post("/api/issues", {
        headers: { origin },
        data: { projectId: project.id, title: "고정 버전 참조" },
      })
    ).json(),
  );
  const doc = resourceDetailSchema.parse(
    await (
      await request.post("/api/resources", {
        headers: { origin },
        data: {
          projectId: project.id,
          kind: "markdown",
          title: "참고 문서",
          markdown: "첫 내용",
          operationId: crypto.randomUUID(),
        },
      })
    ).json(),
  );
  await request.patch(`/api/resources/${doc.resource.id}`, {
    headers: { origin },
    data: {
      revision: 1,
      markdown: "두 번째 내용",
      operationId: crypto.randomUUID(),
    },
  });
  await page.context().addCookies((await request.storageState()).cookies);
  await page.setViewportSize(
    info.project.name === "iphone"
      ? { width: 375, height: 812 }
      : { width: 1440, height: 960 },
  );
  await page.goto(`/#section=resources&project=${project.id}`);
  await page.getByRole("button", { name: "자료 등록", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "자료 등록", exact: true });
  await editor.getByLabel("자료 종류").selectOption("file");
  await editor.getByLabel("자료 제목").fill("안전하게 내려받는 HTML");
  await editor.getByLabel("파일 선택").focus();
  await expect(editor.getByLabel("파일 선택")).toBeFocused();
  await editor.getByLabel("파일 선택").setInputFiles({
    name: "검토.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      "<script>window.resourceExecuted=true</script><h1>활성 파일</h1>",
    ),
  });
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor).toBeHidden();
  const detail = page.getByRole("region", { name: "자료 상세", exact: true });
  await expect(detail.getByText("검토.html", { exact: true })).toBeVisible();
  await expect(detail.locator("iframe,object,embed,img,script")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await detail
    .getByRole("button", { name: "파일 다운로드", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("검토.html");
  await page.goto(`/#project=${project.id}&issue=${issue.id}`);
  const panel = page.getByRole("dialog", { name: "이슈 상세", exact: true });
  await panel
    .getByRole("button", { name: "기존 자료 연결", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "자료 연결", exact: true });
  await picker
    .getByRole("button", { name: "참고 문서 · v2", exact: true })
    .click();
  await picker.getByLabel("연결할 내용 버전").selectOption("1");
  await picker.getByRole("button", { name: "연결하기", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(panel.getByText("고정 버전 1", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: info.outputPath("resource-pinned-version.png"),
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "참고 문서 연결 해제", exact: true })
    .click();
  const unlink = page.getByRole("dialog", {
    name: "자료 연결 해제",
    exact: true,
  });
  await unlink.getByRole("button", { name: "해제하기", exact: true }).click();
  await expect(unlink).toBeHidden();
  await expect(
    panel.getByText("연결된 자료 없음", { exact: true }),
  ).toBeVisible();
  const preserved = resourceDetailSchema.parse(
    await (await request.get(`/api/resources/${doc.resource.id}`)).json(),
  );
  expect(preserved.history).toHaveLength(2);
});
