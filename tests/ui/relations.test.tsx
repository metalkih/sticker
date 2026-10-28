import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { sessionHttpFixture, sessionOwner } from "../session-fixture.js";
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
const { render, screen, cleanup, waitFor, act } =
  await import("@testing-library/react");
const { userEvent } = await import("@testing-library/user-event");
const nativeFetch = globalThis.fetch;
void test("relationship picker supports search, cancel, addition, conflict draft retention and deletion", async () => {
  const f = await sessionHttpFixture();
  const user = userEvent.setup({ document: dom.window.document });
  const other = f.instance.store.createIssue(sessionOwner, {
    projectId: f.project.id,
    title: "검색할 자식",
  });
  const login = await nativeFetch(`${f.base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "disposable-session-owner-password" }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  let failRefresh = false;
  globalThis.fetch = (input, init = {}) => {
    if (failRefresh) return Promise.reject(new Error("offline fixture"));
    return nativeFetch(
      new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        f.base,
      ),
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          cookie,
          origin: "http://localhost:8787",
        },
      },
    );
  };
  try {
    const { IssueRelations } =
      await import("../../client/features/relations/IssueRelations.js");
    const data = f.instance.store.bootstrap(sessionOwner);
    const view = render(
      <IssueRelations
        issue={f.issue}
        data={data}
        onChanged={async () => {}}
        onOpen={() => {}}
      />,
    );
    await screen.findByText("연결된 이슈가 없어요.");
    assert.equal(screen.queryByText(/관계는 상태 정보예요/) !== null, false);

    await user.click(screen.getByRole("button", { name: "관계 추가" }));
    assert.equal(
      screen.queryByText(/자기 참조·순환·두 번째 부모/) !== null,
      false,
    );
    await user.type(screen.getByLabelText("이슈 검색"), "검색할");
    await user.click(
      screen.getByRole("button", { name: new RegExp(other.key) }),
    );
    await user.selectOptions(screen.getByLabelText("관계 종류"), "child");
    await user.click(screen.getByRole("button", { name: "연결하기" }));
    await screen.findByRole("heading", { name: "하위 이슈", level: 4 });
    await waitFor(() => {
      assert.equal(
        f.instance.store.relations.get(sessionOwner, f.issue.id).children
          .length,
        1,
      );
    });
    failRefresh = true;
    await user.click(screen.getByRole("button", { name: "관계 새로고침" }));
    await screen.findByText(/이전 관계 정보입니다/);
    assert.ok(screen.getByRole("heading", { name: "하위 이슈", level: 4 }));
    failRefresh = false;
    await user.click(screen.getByRole("button", { name: "관계 추가" }));
    await user.click(
      screen.getByRole("button", { name: new RegExp(`${other.key} ·`) }),
    );
    await user.click(screen.getByRole("button", { name: "연결하기" }));
    await screen.findByText(/다른 변경 사항이 있거나/);
    assert.equal(
      screen
        .getByRole("button", { name: new RegExp(`${other.key} ·`) })
        .getAttribute("aria-pressed"),
      "true",
    );
    await user.keyboard("{Escape}");
    assert.equal(screen.queryByLabelText("이슈 검색"), null);
    view.rerender(
      <IssueRelations
        issue={f.instance.store.getIssue(sessionOwner, f.issue.id).issue}
        data={f.instance.store.bootstrap(sessionOwner)}
        onChanged={async () => {}}
        onOpen={() => {}}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: `${other.key} 관계 해제` }),
    );
    await screen.findByText("연결된 이슈가 없어요.");
    assert.equal(
      f.instance.store.relations.get(sessionOwner, f.issue.id).children.length,
      0,
    );
  } finally {
    cleanup();
    globalThis.fetch = nativeFetch;
    await f.close();
  }
});
void test("summary exposes keyboard buttons, distinct done/closed counts and stale provenance", async () => {
  const { RelationSummary } =
    await import("../../client/features/relations/RelationSummary.js");
  const user = userEvent.setup({ document: dom.window.document }),
    opened: string[] = [];
  try {
    render(
      <RelationSummary
        summary={{
          blocked: true,
          blockers: [
            {
              id: "a",
              projectId: "p",
              key: "RL-1",
              title: "선행",
              status: "done",
              revision: 2,
            },
          ],
          childCounts: {
            backlog: 0,
            ready: 0,
            in_progress: 0,
            waiting: 0,
            done: 2,
            closed: 1,
          },
        }}
        stale
        onOpen={(id) => {
          opened.push(id);
        }}
      />,
    );
    assert.ok(screen.getByText("하위 3 · 구현 완료 2 · 소유자 종결 1"));
    assert.ok(screen.getByText("이전 정보 · 최신 확인 실패"));
    screen.getByRole("button", { name: "차단 원인 RL-1: 선행" }).focus();
    await user.keyboard("{Enter}");
    assert.deepEqual(opened, ["a"]);
  } finally {
    cleanup();
  }
});
void test("out-of-order relation summary replies cannot replace newer success or clear newer failure", async () => {
  const f = await sessionHttpFixture();
  const pending: Array<(response: Response) => void> = [];
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      pending.push(resolve);
    });
  const { useRelationSummaries } =
    await import("../../client/features/relations/RelationSummary.js");
  const data = f.instance.store.bootstrap(sessionOwner),
    counts = {
      backlog: 0,
      ready: 0,
      in_progress: 0,
      waiting: 0,
      done: 0,
      closed: 0,
    };
  // Stable snapshots change only on explicit rerender, not the hook's own setState.
  function StableProbe({ snapshot }: { snapshot: typeof data }) {
    const state = useRelationSummaries(snapshot);
    return (
      <output>
        {JSON.stringify(state.summaries)}|{state.error}
      </output>
    );
  }
  const response = (blocked: boolean) =>
    new Response(
      JSON.stringify({ i: { blocked, blockers: [], childCounts: counts } }),
      { headers: { "content-type": "application/json" } },
    );
  try {
    const view = render(<StableProbe snapshot={data} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    view.rerender(<StableProbe snapshot={{ ...data }} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(pending.length, 2);
    await act(async () => {
      await Promise.resolve();
      pending[1](response(false));
    });
    await act(async () => {
      await Promise.resolve();
      pending[0](response(true));
    });
    assert.match(view.container.textContent, /"blocked":false/);
    view.rerender(<StableProbe snapshot={{ ...data }} />);
    view.rerender(<StableProbe snapshot={{ ...data }} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(pending.length, 4);
    await act(async () => {
      await Promise.resolve();
      pending[3](
        new Response(JSON.stringify({ error: "new failure" }), { status: 500 }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      pending[2](response(true));
    });
    assert.match(view.container.textContent, /new failure/);
    assert.match(view.container.textContent, /"blocked":false/);
    view.rerender(<StableProbe snapshot={{ ...data }} />);
    view.rerender(<StableProbe snapshot={{ ...data }} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      pending[5](response(false));
    });
    await act(async () => {
      await Promise.resolve();
      pending[4](
        new Response(JSON.stringify({ error: "old failure" }), { status: 500 }),
      );
    });
    assert.equal(view.container.textContent.includes("failure"), false);
  } finally {
    cleanup();
    globalThis.fetch = nativeFetch;
    await f.close();
  }
});
void test("out-of-order detail refreshes preserve newer snapshot and failure provenance", async () => {
  const f = await sessionHttpFixture(),
    pending: Array<(response: Response) => void> = [];
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      pending.push(resolve);
    });
  const { IssueRelations } =
    await import("../../client/features/relations/IssueRelations.js");
  const user = userEvent.setup({ document: dom.window.document });
  const payload = (title: string) => ({
    blocked: false,
    blockers: [],
    childCounts: {
      backlog: 1,
      ready: 0,
      in_progress: 0,
      waiting: 0,
      done: 0,
      closed: 0,
    },
    parent: null,
    related: [],
    blockerRelations: [],
    blocking: [],
    children: [
      {
        relation: {
          id: "edge",
          projectId: f.project.id,
          kind: "parent",
          sourceIssueId: f.issue.id,
          targetIssueId: "child",
          createdBy: "owner",
          createdAt: "2026-10-28T00:00:00Z",
        },
        issue: {
          id: "child",
          projectId: f.project.id,
          key: "CH-1",
          title,
          status: "backlog",
          revision: 1,
        },
      },
    ],
  });
  const response = (title: string) =>
    new Response(JSON.stringify(payload(title)), {
      headers: { "content-type": "application/json" },
    });
  try {
    render(
      <IssueRelations
        issue={f.issue}
        data={f.instance.store.bootstrap(sessionOwner)}
        onChanged={async () => {}}
        onOpen={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "관계 새로고침" }));
    assert.equal(pending.length, 2);
    await act(async () => {
      await Promise.resolve();
      pending[1](response("새 결과"));
    });
    await act(async () => {
      await Promise.resolve();
      pending[0](response("오래된 결과"));
    });
    assert.equal(screen.queryByText(/오래된 결과/) !== null, false);
    assert.ok(screen.getByRole("button", { name: /새 결과/ }));
    await user.click(screen.getByRole("button", { name: "관계 새로고침" }));
    await user.click(screen.getByRole("button", { name: "관계 새로고침" }));
    await act(async () => {
      await Promise.resolve();
      pending[3](
        new Response(JSON.stringify({ error: "새 요청 실패" }), {
          status: 500,
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      pending[2](response("오래된 성공"));
    });
    assert.ok(screen.getByText("새 요청 실패"));
    assert.ok(screen.getByText(/이전 관계 정보/));
    assert.equal(screen.queryByText(/오래된 성공/) !== null, false);
    await user.click(screen.getByRole("button", { name: "관계 새로고침" }));
    await user.click(screen.getByRole("button", { name: "관계 새로고침" }));
    await act(async () => {
      await Promise.resolve();
      pending[5](response("최신 결과"));
    });
    await act(async () => {
      await Promise.resolve();
      pending[4](
        new Response(JSON.stringify({ error: "오래된 실패" }), { status: 500 }),
      );
    });
    assert.equal(screen.queryByRole("alert") !== null, false);
    assert.ok(screen.getByRole("button", { name: /최신 결과/ }));
  } finally {
    cleanup();
    globalThis.fetch = nativeFetch;
    await f.close();
  }
});
void test("workspace keeps search and project while keyboard opening and closing a blocker", async () => {
  const f = await sessionHttpFixture();
  const login = await nativeFetch(`${f.base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "disposable-session-owner-password" }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  globalThis.fetch = (input, init = {}) =>
    nativeFetch(
      new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        f.base,
      ),
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          cookie,
          origin: "http://localhost:8787",
        },
      },
    );
  try {
    const blocker = f.instance.store.createIssue(sessionOwner, {
      projectId: f.project.id,
      title: "선행 작업",
    });
    f.instance.store.relations.add(sessionOwner, blocker.id, {
      kind: "blocks",
      targetIssueId: f.issue.id,
      sourceRevision: blocker.revision,
      targetRevision: f.issue.revision,
    });
    dom.window.history.replaceState({}, "", `/#project=${f.project.id}`);
    const App = (await import("../../client/App.js")).default;
    const user = userEvent.setup({ document: dom.window.document });
    render(<App />);
    const search = await screen.findByPlaceholderText("이슈 검색…");
    await user.type(search, "입력 요청");
    const link = await screen.findByRole("button", {
      name: new RegExp(`차단 원인 ${blocker.key}`),
    });
    link.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("heading", { name: "선행 작업" });
    assert.equal(
      document.activeElement,
      screen.getByRole("dialog", { name: "이슈 상세" }),
    );
    await user.keyboard("{Escape}");
    await waitFor(() => {
      assert.equal(screen.queryByRole("dialog", { name: "이슈 상세" }), null);
    });
    assert.equal((search as HTMLInputElement).value, "입력 요청");
    assert.equal(
      new URLSearchParams(dom.window.location.hash.slice(1)).get("project"),
      f.project.id,
    );
    assert.equal(document.activeElement, link);
  } finally {
    cleanup();
    globalThis.fetch = nativeFetch;
    await f.close();
  }
});
