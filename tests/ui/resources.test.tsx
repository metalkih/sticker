import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
const dom = new JSDOM("<html><body></body></html>", {
  url: "http://localhost:8787/",
});
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Node",
  "MutationObserver",
  "getComputedStyle",
])
  Object.defineProperty(globalThis, name, {
    value: (dom.window as unknown as Record<string, unknown>)[name],
    configurable: true,
    writable: true,
  });
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const { render, screen, cleanup } = await import("@testing-library/react");
void test("safe Markdown renders structure and validated links without raw HTML, active URLs or remote image requests", async () => {
  const { SafeMarkdown } =
    await import("../../client/features/resources/SafeMarkdown.js");
  try {
    const view = render(
      <SafeMarkdown
        value={
          '# 설계\n\n<script>alert(1)</script>\n![외부](https://example.test/a.png)\n[안전](https://example.test/docs) [위험](javascript:alert)\n\n```html\n<svg onload="alert(1)">\n```\n\n- 첫 항목\n- 둘째 항목'
        }
      />,
    );
    assert.ok(screen.getByRole("heading", { name: "설계" }));
    assert.equal(
      screen.getByRole("link", { name: "안전" }).getAttribute("href"),
      "https://example.test/docs",
    );
    assert.equal(
      view.container.querySelectorAll("script,svg,img,iframe").length,
      0,
    );
    assert.equal(
      view.container.querySelectorAll('a[href^="javascript:"]').length,
      0,
    );
    assert.equal(view.container.querySelectorAll("li").length, 2);
    assert.ok(screen.getByText('<svg onload="alert(1)">'));
  } finally {
    cleanup();
  }
});
void test("resource editor retains content on revision conflict and explicitly rebases without losing the draft", async () => {
  const { ResourceEditor } =
    await import("../../client/features/resources/ResourceEditor.js");
  const { sessionHttpFixture, sessionOwner } =
    await import("../session-fixture.js");
  const { bootstrapSchema } = await import("../../server/response-schemas.js");
  const { userEvent } = await import("@testing-library/user-event");
  const { waitFor } = await import("@testing-library/react");
  const f = await sessionHttpFixture(),
    original = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    typeof input === "string" && input.startsWith("/api")
      ? f.call(
          input.slice(4),
          "owner",
          init?.method ?? "GET",
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
        )
      : original(input, init);
  try {
    const data = bootstrapSchema.parse(
      await (await f.call("/bootstrap")).json(),
    );
    const initial = f.instance.store.resources.create(sessionOwner, {
      projectId: f.project.id,
      kind: "markdown",
      title: "설계",
      markdown: "original",
      operationId: crypto.randomUUID(),
    });
    let saved = false;
    const user = userEvent.setup({ document: dom.window.document });
    render(
      <ResourceEditor
        data={data}
        projectId={f.project.id}
        initial={initial}
        onClose={() => {}}
        onSaved={() => {
          saved = true;
        }}
      />,
    );
    await user.clear(screen.getByLabelText("Markdown 내용"));
    await user.type(screen.getByLabelText("Markdown 내용"), "local draft");
    f.instance.store.resources.update(sessionOwner, initial.resource.id, {
      revision: 1,
      operationId: crypto.randomUUID(),
      markdown: "remote",
    });
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByRole("alert");
    assert.equal(
      screen.getByLabelText<HTMLTextAreaElement>("Markdown 내용").value,
      "local draft",
    );
    await user.click(screen.getByRole("button", { name: "최신 자료 확인" }));
    await screen.findByText("내용 버전 2");
    await screen.findByText("remote");
    assert.equal(
      screen.getByLabelText<HTMLTextAreaElement>("Markdown 내용").value,
      "local draft",
    );
    await user.click(
      screen.getByRole("button", { name: "이 버전 기준으로 검토" }),
    );
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      assert.equal(saved, true);
    });
    assert.equal(
      f.instance.store.resources.get(sessionOwner, initial.resource.id).current
        ?.kind,
      "markdown",
    );
    const content = f.instance.store.resources.get(
      sessionOwner,
      initial.resource.id,
    ).current;
    assert.ok(content?.kind === "markdown");
    assert.equal(content.markdown, "local draft");
  } finally {
    cleanup();
    globalThis.fetch = original;
    await f.close();
  }
});
void test("resource detail keeps exact historical content and owner guidance separate, accepts deletion tombstone without losing history", async () => {
  const { ResourceDetailView } =
    await import("../../client/features/resources/ResourceDetail.js");
  const { sessionHttpFixture, sessionOwner } =
    await import("../session-fixture.js");
  const { bootstrapSchema } = await import("../../server/response-schemas.js");
  const { userEvent } = await import("@testing-library/user-event");
  const { within } = await import("@testing-library/react");
  const f = await sessionHttpFixture(),
    original = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    typeof input === "string" && input.startsWith("/api")
      ? f.call(
          input.slice(4),
          "owner",
          init?.method ?? "GET",
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
        )
      : original(input, init);
  try {
    const data = bootstrapSchema.parse(
      await (await f.call("/bootstrap")).json(),
    );
    const created = f.instance.store.resources.create(sessionOwner, {
      projectId: f.project.id,
      kind: "markdown",
      title: "공통 설계",
      markdown: "이전 내용",
      operationId: crypto.randomUUID(),
    });
    f.instance.store.resources.update(sessionOwner, created.resource.id, {
      revision: 1,
      markdown: "현재 내용",
      operationId: crypto.randomUUID(),
    });
    const user = userEvent.setup({ document: dom.window.document });
    render(
      <ResourceDetailView
        id={created.resource.id}
        data={data}
        onBack={() => {}}
      />,
    );
    await screen.findByText("현재 내용");
    await user.selectOptions(screen.getByLabelText("내용 이력"), "1");
    await screen.findByText("이전 내용");
    await user.click(screen.getByRole("button", { name: "지침 지정" }));
    const confirmation = screen.getByRole("dialog", {
      name: "소유자 지침 지정",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "지정하기" }),
    );
    await screen.findByText("소유자 지정 지침");
    await user.click(screen.getByRole("button", { name: "자료 삭제" }));
    const deletion = screen.getByRole("dialog", { name: "자료 삭제" });
    await user.click(
      within(deletion).getByRole("button", { name: "삭제하기" }),
    );
    await screen.findByText("삭제된 자료");
    await screen.findByText("이전 내용");
    assert.equal(
      f.instance.store.resources.get(sessionOwner, created.resource.id).history
        .length,
      2,
    );
  } finally {
    cleanup();
    globalThis.fetch = original;
    await f.close();
  }
});
void test("resource workspace searches and filters within the selected project without leaking foreign resources", async () => {
  const { ResourceWorkspace } =
    await import("../../client/features/resources/ResourceWorkspace.js");
  const { sessionHttpFixture, sessionOwner } =
    await import("../session-fixture.js");
  const { bootstrapSchema } = await import("../../server/response-schemas.js");
  const { userEvent } = await import("@testing-library/user-event");
  const { waitFor } = await import("@testing-library/react");
  const f = await sessionHttpFixture(),
    original = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    typeof input === "string" && input.startsWith("/api")
      ? f.call(
          input.slice(4),
          "owner",
          init?.method ?? "GET",
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
        )
      : original(input, init);
  try {
    for (const [projectId, title, kind] of [
      [f.project.id, "찾을 설계", "markdown"],
      [f.project.id, "공식 문서", "link"],
      [f.other.id, "비공개 타프로젝트", "markdown"],
    ] as const)
      f.instance.store.resources.create(sessionOwner, {
        projectId,
        title,
        kind,
        ...(kind === "markdown"
          ? { markdown: "내용" }
          : { url: "https://example.test" }),
        operationId: crypto.randomUUID(),
      });
    const data = bootstrapSchema.parse(
      await (await f.call("/bootstrap")).json(),
    );
    const user = userEvent.setup({ document: dom.window.document });
    render(
      <ResourceWorkspace
        projectId={f.project.id}
        resourceId=""
        scopeVersion=""
        data={data}
        onSelect={() => {}}
        onScope={() => {}}
      />,
    );
    await screen.findByRole("button", { name: /찾을 설계/ });
    assert.ok(screen.queryByText("비공개 타프로젝트") === null);
    await user.selectOptions(screen.getByLabelText("자료 유형 필터"), "link");
    await screen.findByRole("button", { name: /공식 문서/ });
    await waitFor(() => {
      assert.ok(screen.queryByRole("button", { name: /찾을 설계/ }) === null);
    });
    await user.type(screen.getByLabelText("자료 검색"), "없는 자료");
    await screen.findByText("자료 없음");
  } finally {
    cleanup();
    globalThis.fetch = original;
    await f.close();
  }
});
void test("issue resource picker pins the selected old version and unlink removes only its reference", async () => {
  const { IssueResources } =
    await import("../../client/features/resources/IssueResources.js");
  const { sessionHttpFixture, sessionOwner } =
    await import("../session-fixture.js");
  const { userEvent } = await import("@testing-library/user-event");
  const { within, waitFor } = await import("@testing-library/react");
  const f = await sessionHttpFixture(),
    original = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    typeof input === "string" && input.startsWith("/api")
      ? f.call(
          input.slice(4),
          "owner",
          init?.method ?? "GET",
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
        )
      : original(input, init);
  try {
    const doc = f.instance.store.resources.create(sessionOwner, {
      projectId: f.project.id,
      kind: "markdown",
      title: "공유 문서",
      markdown: "v1 본문",
      operationId: crypto.randomUUID(),
    });
    f.instance.store.resources.update(sessionOwner, doc.resource.id, {
      revision: 1,
      markdown: "v2 본문",
      operationId: crypto.randomUUID(),
    });
    const user = userEvent.setup({ document: dom.window.document });
    function Harness() {
      const [issue, setIssue] = React.useState(f.issue);
      return (
        <IssueResources
          issue={issue}
          canWrite={true}
          onChanged={() => {
            setIssue(f.instance.store.getIssue(sessionOwner, issue.id).issue);
            return Promise.resolve();
          }}
        />
      );
    }
    render(<Harness />);
    await screen.findByText("연결된 자료 없음");
    await user.click(screen.getByRole("button", { name: "기존 자료 연결" }));
    const dialog = screen.getByRole("dialog", { name: "자료 연결" });
    await user.click(
      await within(dialog).findByRole("button", { name: /공유 문서/ }),
    );
    await within(dialog).findByLabelText("연결할 내용 버전");
    await user.selectOptions(
      within(dialog).getByLabelText("연결할 내용 버전"),
      "1",
    );
    await user.click(within(dialog).getByRole("button", { name: "연결하기" }));
    await waitFor(() => {
      assert.ok(screen.queryByRole("dialog") === null);
    });
    await screen.findByText("고정 버전 1");
    assert.equal(
      f.instance.store.resources.issueLinks(sessionOwner, f.issue.id)[0].version
        .version,
      1,
    );
    await user.click(
      screen.getByRole("button", { name: "공유 문서 연결 해제" }),
    );
    const confirm = screen.getByRole("dialog", { name: "자료 연결 해제" });
    await user.click(within(confirm).getByRole("button", { name: "해제하기" }));
    await screen.findByText("연결된 자료 없음");
    assert.equal(
      f.instance.store.resources.get(sessionOwner, doc.resource.id).history
        .length,
      2,
    );
  } finally {
    cleanup();
    globalThis.fetch = original;
    await f.close();
  }
});
void test("resource editor guards dirty navigation and retries an unknown create response without duplicating the resource", async () => {
  const { ResourceEditor } =
    await import("../../client/features/resources/ResourceEditor.js");
  const { sessionHttpFixture } = await import("../session-fixture.js");
  const { bootstrapSchema } = await import("../../server/response-schemas.js");
  const { navigate } = await import("../../client/router.js");
  const { userEvent } = await import("@testing-library/user-event");
  const { waitFor } = await import("@testing-library/react");
  const f = await sessionHttpFixture(),
    original = globalThis.fetch,
    originalConfirm = dom.window.confirm;
  let drop = true,
    denyRetry = false,
    saved = false;
  globalThis.fetch = async (input, init) => {
    if (typeof input !== "string" || !input.startsWith("/api"))
      return original(input, init);
    if (input === "/api/resources" && init?.method === "POST" && denyRetry) {
      denyRetry = false;
      return Response.json(
        { error: "재시도 권한 없음", code: "FORBIDDEN" },
        { status: 403 },
      );
    }
    const response = await f.call(
      input.slice(4),
      "owner",
      init?.method ?? "GET",
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as unknown)
        : undefined,
    );
    if (input === "/api/resources" && init?.method === "POST" && drop) {
      drop = false;
      denyRetry = true;
      await response.clone().json();
      throw new Error("응답 미확인");
    }
    return response;
  };
  try {
    const data = bootstrapSchema.parse(
      await (await f.call("/bootstrap")).json(),
    );
    dom.window.location.hash = "section=resources";
    dom.window.confirm = () => false;
    const user = userEvent.setup({ document: dom.window.document });
    render(
      <ResourceEditor
        data={data}
        projectId={f.project.id}
        onClose={() => {}}
        onSaved={() => {
          saved = true;
        }}
      />,
    );
    await user.type(screen.getByLabelText("자료 제목"), "한 번만 생성");
    await user.type(screen.getByLabelText("Markdown 내용"), "초안");
    navigate({ section: "issues" });
    assert.equal(dom.window.location.hash, "#section=resources");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("응답 미확인");
    const pendingTitle = screen.getByLabelText<HTMLInputElement>("자료 제목");
    assert.equal(pendingTitle.disabled, true);
    await user.type(pendingTitle, "새로운 자료");
    assert.equal(pendingTitle.value, "한 번만 생성");
    assert.equal(
      screen.getByLabelText<HTMLTextAreaElement>("Markdown 내용").disabled,
      true,
    );
    await user.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("재시도 권한 없음");
    assert.equal(pendingTitle.disabled, true);
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      assert.equal(saved, true);
    });
    const response = await f.call(`/resources?projectId=${f.project.id}`);
    const list = (await response.json()) as unknown;
    assert.ok(Array.isArray(list));
    assert.equal(list.length, 1);
  } finally {
    cleanup();
    dom.window.confirm = originalConfirm;
    globalThis.fetch = original;
    await f.close();
  }
});
void test("file content download failure remains local and active formats never render as image or embedded HTML", async () => {
  const { ResourceContent } =
    await import("../../client/features/resources/ResourceContent.js");
  const { userEvent } = await import("@testing-library/user-event");
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response("denied", { status: 403 }));
  try {
    const view = render(
      <ResourceContent
        version={{
          resourceId: crypto.randomUUID(),
          version: 1,
          title: "외부 HTML",
          kind: "file",
          fileName: "document.html",
          mimeType: "text/html",
          size: 30,
          checksum: "a".repeat(64),
          markdown: null,
          url: null,
          authorId: "owner",
          authorName: "Owner",
          createdAt: new Date().toISOString(),
        }}
      />,
    );
    assert.equal(
      view.container.querySelectorAll("img,iframe,object,embed").length,
      0,
    );
    const user = userEvent.setup({ document: dom.window.document });
    await user.click(screen.getByRole("button", { name: "파일 다운로드" }));
    await screen.findByText("다운로드 실패 (403)");
    assert.ok(screen.getByText("document.html"));
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
void test("resource detail does not render another project under a mismatched project route", async () => {
  const { ResourceDetailView } =
    await import("../../client/features/resources/ResourceDetail.js");
  const { sessionHttpFixture, sessionOwner } =
    await import("../session-fixture.js");
  const { bootstrapSchema } = await import("../../server/response-schemas.js");
  const f = await sessionHttpFixture(),
    original = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    typeof input === "string" && input.startsWith("/api")
      ? f.call(input.slice(4), "owner", init?.method ?? "GET")
      : original(input, init);
  try {
    const doc = f.instance.store.resources.create(sessionOwner, {
      projectId: f.other.id,
      kind: "markdown",
      title: "다른 프로젝트 자료",
      markdown: "다른 프로젝트 본문",
      operationId: crypto.randomUUID(),
    });
    const data = bootstrapSchema.parse(
      await (await f.call("/bootstrap")).json(),
    );
    render(
      <ResourceDetailView
        id={doc.resource.id}
        projectId={f.project.id}
        data={data}
        onBack={() => {}}
      />,
    );
    await screen.findByText("프로젝트 범위가 일치하지 않습니다.");
    assert.ok(screen.queryByText("다른 프로젝트 본문") === null);
    assert.ok(screen.queryByRole("button", { name: "자료 편집" }) === null);
  } finally {
    cleanup();
    globalThis.fetch = original;
    await f.close();
  }
});
void test("file upload cancellation retains inputs and reports unknown outcome; oversized selection is rejected before transport", async () => {
  const { ResourceEditor } =
    await import("../../client/features/resources/ResourceEditor.js");
  const { sessionHttpFixture } = await import("../session-fixture.js");
  const { bootstrapSchema } = await import("../../server/response-schemas.js");
  const { userEvent } = await import("@testing-library/user-event");
  const { waitFor, fireEvent } = await import("@testing-library/react");
  const f = await sessionHttpFixture(),
    originalFetch = globalThis.fetch,
    originalForm = globalThis.FormData;
  try {
    const data = bootstrapSchema.parse(
      await (await f.call("/bootstrap")).json(),
    );
    let calls = 0;
    Object.defineProperty(globalThis, "FormData", {
      value: dom.window.FormData,
      configurable: true,
      writable: true,
    });
    globalThis.fetch = (input, init) => {
      if (typeof input === "string" && input.includes("/resources/files")) {
        calls++;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("aborted fixture"));
            },
            { once: true },
          );
        });
      }
      return originalFetch(input, init);
    };
    const user = userEvent.setup({ document: dom.window.document });
    render(
      <ResourceEditor
        data={data}
        projectId={f.project.id}
        onClose={() => {}}
        onSaved={() => {
          assert.fail("No success response was received");
        }}
      />,
    );
    await user.selectOptions(screen.getByLabelText("자료 종류"), "file");
    await user.type(screen.getByLabelText("자료 제목"), "진행 중 업로드");
    const input = screen.getByLabelText<HTMLInputElement>("파일 선택");
    await user.upload(
      input,
      new dom.window.File(["fixture bytes"], "원본.txt", {
        type: "text/plain",
      }),
    );
    assert.equal(input.files?.length, 1);
    assert.ok(input.form);
    // JSDOM checks its internal FileList, not user-event's uploaded files.
    // Dispatch submit here; hosted resources.spec.ts covers native validation.
    fireEvent.submit(input.form);
    await screen.findByRole("button", { name: "업로드 중…" });
    await user.click(screen.getByRole("button", { name: "전송 취소" }));
    await screen.findByText(
      "전송 응답 미확인 · 같은 입력으로 다시 저장하여 확인하세요.",
    );
    await waitFor(() => {
      assert.equal(
        screen.getByRole<HTMLButtonElement>("button", { name: "저장" })
          .disabled,
        false,
      );
    });
    assert.equal(input.files[0].name, "원본.txt");
    assert.equal(
      screen.getByLabelText<HTMLInputElement>("자료 제목").value,
      "진행 중 업로드",
    );
    assert.equal(input.disabled, true);
    cleanup();
    render(
      <ResourceEditor
        data={data}
        projectId={f.project.id}
        onClose={() => {}}
        onSaved={() => {
          assert.fail("Oversized upload must not be sent");
        }}
      />,
    );
    await user.selectOptions(screen.getByLabelText("자료 종류"), "file");
    await user.type(screen.getByLabelText("자료 제목"), "큰 파일");
    const oversizedInput = screen.getByLabelText<HTMLInputElement>("파일 선택");
    const large = new dom.window.File(
      [new Uint8Array(20 * 1024 * 1024 + 1)],
      "큰파일.bin",
    );
    await user.upload(oversizedInput, large);
    assert.ok(oversizedInput.form);
    fireEvent.submit(oversizedInput.form);
    await screen.findByText("파일은 20 MiB 이하여야 합니다.");
    assert.equal(calls, 1);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "FormData", {
      value: originalForm,
      configurable: true,
      writable: true,
    });
    await f.close();
  }
});
void test("same-resource version routes update content and preserve the dirty editor when navigation is rejected", async () => {
  const { ResourceWorkspace } =
    await import("../../client/features/resources/ResourceWorkspace.js");
  const { sessionHttpFixture, sessionOwner } =
    await import("../session-fixture.js");
  const { readRoute, subscribeRoute, navigate } =
    await import("../../client/router.js");
  const { act } = await import("@testing-library/react");
  const { userEvent } = await import("@testing-library/user-event");
  const f = await sessionHttpFixture(),
    original = globalThis.fetch,
    originalConfirm = dom.window.confirm;
  try {
    const doc = f.instance.store.resources.create(sessionOwner, {
      projectId: f.project.id,
      kind: "markdown",
      title: "경로 버전",
      markdown: "첫 내용",
      operationId: crypto.randomUUID(),
    });
    f.instance.store.resources.update(sessionOwner, doc.resource.id, {
      revision: 1,
      markdown: "둘째 내용",
      operationId: crypto.randomUUID(),
    });
    globalThis.fetch = (input, init) =>
      typeof input === "string" && input.startsWith("/api")
        ? f.call(input.slice(4), "owner", init?.method ?? "GET")
        : original(input, init);
    dom.window.location.hash = `section=resources&project=${f.project.id}&resource=${doc.resource.id}&resourceVersion=1`;
    function Harness() {
      const [route, setRoute] = React.useState(readRoute);
      React.useEffect(() => subscribeRoute(setRoute), []);
      return (
        <ResourceWorkspace
          projectId={f.project.id}
          resourceId={route.resource}
          contentVersion={route.resourceVersion}
          scopeVersion=""
          data={f.instance.store.bootstrap(sessionOwner)}
          onSelect={() => {}}
          onScope={() => {}}
        />
      );
    }
    render(<Harness />);
    await screen.findByText("첫 내용");
    act(() => {
      navigate({ resourceVersion: "2" });
    });
    await screen.findByText("둘째 내용");
    assert.ok(screen.queryByText("첫 내용") === null);
    act(() => {
      navigate({ resourceVersion: "1" });
    });
    await screen.findByText("첫 내용");
    const user = userEvent.setup({ document: dom.window.document });
    await user.click(screen.getByRole("button", { name: "자료 편집" }));
    await user.type(screen.getByLabelText("Markdown 내용"), " 보존할 초안");
    dom.window.confirm = () => false;
    act(() => {
      navigate({ resourceVersion: "2" });
    });
    assert.equal(readRoute().resourceVersion, "1");
    assert.match(
      screen.getByLabelText<HTMLTextAreaElement>("Markdown 내용").value,
      /보존할 초안/,
    );
    assert.ok(screen.getByText("첫 내용"));
    dom.window.confirm = () => true;
    act(() => {
      navigate({ resourceVersion: "2" });
    });
    await screen.findByText("둘째 내용");
    assert.ok(screen.queryByRole("dialog", { name: "자료 편집" }) === null);
  } finally {
    cleanup();
    globalThis.fetch = original;
    dom.window.confirm = originalConfirm;
    await f.close();
  }
});
