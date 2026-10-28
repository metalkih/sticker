import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import React from "react";
import { createApp } from "../../server/app.js";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:8787/",
});
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
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
const { render, screen, waitFor, cleanup, within, act } =
  await import("@testing-library/react");
const { userEvent } = await import("@testing-library/user-event");
const App = (await import("../../client/App.js")).default;
const nativeFetch = globalThis.fetch;
const password = "temporary-dom-test-password";
async function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "sticker-ui-"));
  const instance = createApp({
    dataDir,
    ownerPassword: password,
    appOrigin: "http://localhost:8787",
  });
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = "";
  globalThis.fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) => {
    const path = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    if (init.method && !["GET", "HEAD"].includes(init.method))
      headers.set("origin", "http://localhost:8787");
    const r = await nativeFetch(new URL(path, base), { ...init, headers });
    const received = r.headers.get("set-cookie");
    if (received) cookie = received.split(";")[0];
    return r;
  };
  dom.window.history.replaceState({}, "", "/");
  const user = userEvent.setup({ document: dom.window.document });
  render(<App />);
  return {
    instance,
    user,
    async close() {
      cleanup();
      server.closeAllConnections();
      globalThis.fetch = nativeFetch;
      await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
      instance.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
    async login() {
      await screen.findByRole("heading", { name: /생각을 붙이고/ });
      await user.type(screen.getByLabelText("소유자 비밀번호"), password);
      await user.click(screen.getByRole("button", { name: "작업 공간 열기" }));
      await screen.findByRole("heading", { name: "내 작업 공간" });
    },
    async click(name: string) {
      await user.click(screen.getAllByRole("button", { name })[0]);
    },
  };
}
test("DOM + real API: login, project/issue persistence, comments, links, status and cancel", async () => {
  const f = await fixture();
  try {
    await f.login();
    assert.ok(screen.getByText("첫 번째 스티커를 붙여 볼까요?"));
    await f.click("새 프로젝트");
    await f.user.type(
      screen.getByLabelText("프로젝트 이름"),
      "실제 UI 프로젝트",
    );
    await f.user.type(screen.getByLabelText("프로젝트 키"), "UIT");
    await f.click("프로젝트 만들기");
    await screen.findByRole("heading", { name: "실제 UI 프로젝트" });
    await f.click("새 이슈");
    await f.user.type(
      screen.getByLabelText("이슈 제목"),
      "첫 번째 실제 스티커",
    );
    await f.user.type(
      screen.getByLabelText("설명", {}),
      "클라이언트에서 서버까지 연결됩니다.",
    );
    await f.click("이슈 만들기");
    await screen.findByRole("heading", {
      name: "첫 번째 실제 스티커",
      level: 2,
    });
    await f.user.type(
      screen.getByLabelText("댓글 작성"),
      "검증한 내용을 남겨요.",
    );
    await f.click("댓글 남기기");
    await screen.findByText("검증한 내용을 남겨요.", {});
    await f.click("링크 추가");
    await f.user.type(screen.getByLabelText("링크 이름"), "API 참고");
    await f.user.type(
      screen.getByLabelText("링크 주소"),
      "https://example.com/docs",
    );
    await f.click("링크 저장");
    const resource = await screen.findByRole("link", { name: /API 참고/ });
    assert.equal(resource.getAttribute("href"), "https://example.com/docs");
    assert.equal(resource.getAttribute("rel"), "noopener noreferrer");
    await f.click("이슈 편집");
    await f.user.selectOptions(screen.getByLabelText("상태", {}), "done");
    await f.click("변경 저장");
    await screen.findByText("구현 완료, 아직 종료 전이에요");
    await f.click("상세 닫기");
    await waitFor(() =>
      assert.equal(
        screen.queryByRole("dialog", { name: "이슈 상세" }) === null,
        true,
      ),
    );
    await f.click("리스트");
    assert.ok(
      await screen.findByRole("button", { name: /UIT-1.*첫 번째 실제 스티커/ }),
    );
    await f.click("새 이슈");
    await f.user.type(screen.getByLabelText("이슈 제목"), "취소한 변경");
    await f.click("취소");
    assert.equal(screen.queryByText("취소한 변경"), null);
    await f.click("보드");
    await f.click("할 일 이슈 추가");
    assert.equal(
      (screen.getByLabelText("상태") as HTMLSelectElement).value,
      "ready",
    );
    await f.click("취소");
    const owner = {
      id: "owner",
      name: "소유자",
      role: "owner" as const,
      canWrite: true,
      projectIds: null,
    };
    const saved = f.instance.store.bootstrap(owner);
    assert.equal(saved.issues.length, 1);
    assert.equal(saved.issues[0].status, "done");
    assert.equal(
      saved.issues[0].description,
      "클라이언트에서 서버까지 연결됩니다.",
    );
    const detail = f.instance.store.getIssue(owner, saved.issues[0].id);
    assert.equal(detail.comments.length, 1);
    assert.equal(detail.attachments.length, 1);
    // A remount is a fresh application load and must retain server data and hash routing.
    await act(async () => {
      dom.window.location.hash = `project=${saved.projects[0].id}&issue=${saved.issues[0].id}`;
    });
    cleanup();
    render(<App />);
    await screen.findByRole("heading", {
      name: "첫 번째 실제 스티커",
      level: 2,
    });
    await screen.findByText("검증한 내용을 남겨요.", {});
  } finally {
    await f.close();
  }
});
test("DOM + real API: wrong password, Escape focus return, version creation/edit/deletion and truthful report empty state", async () => {
  const f = await fixture();
  try {
    await screen.findByLabelText("소유자 비밀번호");
    await f.user.type(screen.getByLabelText("소유자 비밀번호"), "wrong");
    await f.click("작업 공간 열기");
    assert.ok(await screen.findByRole("alert"));
    await f.user.clear(screen.getByLabelText("소유자 비밀번호"));
    await f.login();
    const trigger = screen.getAllByRole("button", { name: "새 프로젝트" })[0];
    await f.user.click(trigger);
    await screen.findByRole("dialog");
    await f.user.keyboard("{Escape}");
    assert.equal(
      screen.queryByRole("dialog") === null,
      true,
      "dialog should be closed",
    );
    assert.equal(
      document.activeElement === trigger,
      true,
      "Escape must restore focus to the opening button",
    );
    await f.click("새 프로젝트");
    await f.user.type(screen.getByLabelText("프로젝트 이름"), "버전 테스트");
    await f.user.type(screen.getByLabelText("프로젝트 키"), "VER");
    await f.click("프로젝트 만들기");
    await screen.findByRole("heading", { name: "버전 테스트" });
    await f.click("버전과 릴리스");
    await screen.findByRole("heading", { name: "버전과 릴리스" });
    await f.click("새 버전");
    await f.user.type(screen.getByLabelText("버전 이름"), "v1.0");
    await f.user.type(screen.getByLabelText("버전 설명"), "첫 배포");
    await f.click("버전 만들기");
    await screen.findByRole("heading", { name: "v1.0" });
    await f.click("v1.0 버전 편집");
    await f.user.selectOptions(screen.getByLabelText("버전 상태"), "released");
    await f.click("변경 저장");
    await screen.findByText("배포됨", {});
    await f.click("v1.0 버전 삭제");
    await f.click("삭제하기");
    await waitFor(() =>
      assert.equal(
        screen.queryByRole("heading", { name: "v1.0" }) === null,
        true,
      ),
    );
    await f.click("에이전트 기록");
    await screen.findByText("상태 보고는 실행 증명이 아니에요.");
    assert.ok(screen.getByText(/아직 전달된 상태 보고가 없어요/));
    await f.click("로그아웃");
    await screen.findByRole("heading", { name: /생각을 붙이고/ });
  } finally {
    await f.close();
  }
});
test("DOM + real API: conflicting issue edits preserve drafts and require review before retry", async () => {
  const f = await fixture();
  try {
    const owner = {
      id: "owner",
      name: "소유자",
      role: "owner" as const,
      canWrite: true,
      projectIds: null,
    };
    const project = f.instance.store.createProject(owner, {
      name: "충돌 검증",
      key: "CON",
    });
    const issue = f.instance.store.createIssue(owner, {
      projectId: project.id,
      title: "원래 제목",
    });
    await f.login();
    await f.user.click(
      screen.getByRole("button", { name: /CON-1.*원래 제목/ }),
    );
    await screen.findByRole("heading", { name: "원래 제목", level: 2 });
    const panel = screen.getByRole("dialog", { name: "이슈 상세" });
    assert.equal(document.body.style.overflow, "hidden");
    const targets = Array.from(
      panel.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]",
      ),
    );
    await act(async () => {
      targets[0].focus();
    });
    await f.user.keyboard("{Shift>}{Tab}{/Shift}");
    assert.equal(
      document.activeElement === targets.at(-1),
      true,
      "Shift+Tab remains in the issue panel",
    );
    await f.user.keyboard("{Tab}");
    assert.equal(
      document.activeElement === targets[0],
      true,
      "Tab loops back to the first panel control",
    );
    const first = within(panel).getByRole("button", { name: "상세 닫기" });
    await f.user.click(first);
    await waitFor(() =>
      assert.equal(
        screen.queryByRole("dialog", { name: "이슈 상세" }) === null,
        true,
      ),
    );
    await f.user.click(
      screen.getByRole("button", { name: /CON-1.*원래 제목/ }),
    );
    await screen.findByRole("heading", { name: "원래 제목", level: 2 });
    await f.click("이슈 편집");
    await f.user.clear(screen.getByLabelText("이슈 제목"));
    await f.user.type(screen.getByLabelText("이슈 제목"), "내 초안 제목");
    f.instance.store.updateIssue(owner, issue.id, {
      revision: issue.revision,
      title: "먼저 저장한 다른 변경",
    });
    await f.click("변경 저장");
    await screen.findByRole("alert");
    assert.equal(
      (screen.getByLabelText("이슈 제목") as HTMLInputElement).value,
      "내 초안 제목",
    );
    await f.click("최신 내용 확인");
    await screen.findByText(/먼저 저장한 다른 변경/);
    await f.click("검토 완료 · 초안 유지");
    await f.click("변경 저장");
    await screen.findByRole("heading", { name: "내 초안 제목", level: 2 });
    assert.equal(
      f.instance.store.getIssue(owner, issue.id).issue.title,
      "내 초안 제목",
    );
  } finally {
    await f.close();
  }
});
test("nested issue/editor teardown restores the original body overflow", async () => {
  for (const initialOverflow of ["", "auto"]) {
    const f = await fixture();
    try {
      document.body.style.overflow = initialOverflow;
      const owner = {
        id: "owner",
        name: "소유자",
        role: "owner" as const,
        canWrite: true,
        projectIds: null,
      };
      const project = f.instance.store.createProject(owner, {
        name: "스크롤 검증",
        key: "SCR",
      });
      f.instance.store.createIssue(owner, {
        projectId: project.id,
        title: "중첩 창",
      });
      await f.login();
      await f.user.click(
        screen.getByRole("button", { name: /SCR-1.*중첩 창/ }),
      );
      await screen.findByRole("heading", { name: "중첩 창", level: 2 });
      await f.click("이슈 편집");
      await screen.findByLabelText("이슈 제목");
      assert.equal(document.body.style.overflow, "hidden");
      // App unmount models the same nested effect teardown as a session-expiry login transition.
      cleanup();
      assert.equal(document.body.style.overflow, initialOverflow);
    } finally {
      await f.close();
      document.body.style.overflow = "";
    }
  }
});
