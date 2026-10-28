import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { z } from "zod";
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
const { render, screen, cleanup, act, waitFor } =
  await import("@testing-library/react");
const { userEvent } = await import("@testing-library/user-event");
const nativeFetch = globalThis.fetch;
void test("view resources are disabled before authentication and never reuse another path or an older reply", async () => {
  const { useViewResource } =
    await import("../../client/features/views/useViewResource.js");
  const schema = z.object({ value: z.string() }),
    pending: Array<(r: Response) => void> = [];
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      pending.push(resolve);
    });
  function Probe({ path, enabled }: { path: string; enabled: boolean }) {
    const resource = useViewResource(path, schema, enabled);
    return (
      <output>
        {resource.value?.value ?? "empty"}|{resource.error}
      </output>
    );
  }
  try {
    const view = render(<Probe path="/a" enabled={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    assert.equal(pending.length, 0);
    view.rerender(<Probe path="/a" enabled />);
    await act(async () => {
      await Promise.resolve();
    });
    view.rerender(<Probe path="/b" enabled />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      pending[1](new Response(JSON.stringify({ value: "new" })));
      await Promise.resolve();
    });
    await act(async () => {
      pending[0](new Response(JSON.stringify({ value: "old" })));
      await Promise.resolve();
    });
    assert.equal(view.container.textContent, "new|");
    view.rerender(<Probe path="/c" enabled />);
    assert.equal(view.container.textContent, "empty|");
  } finally {
    cleanup();
    globalThis.fetch = nativeFetch;
  }
});
import { sessionHttpFixture, sessionOwner } from "../session-fixture.js";
import type { SavedView } from "../../server/contracts/views.js";
async function fixture() {
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
  return {
    ...f,
    user: userEvent.setup({ document: dom.window.document }),
    async dispose() {
      cleanup();
      globalThis.fetch = nativeFetch;
      await f.close();
    },
  };
}
void test("view name editor persists predicates and retains name on duplicate or revision conflicts", async () => {
  const f = await fixture();
  try {
    const { SavedViewEditor } =
      await import("../../client/features/views/SavedViewEditor.js");
    const saved: SavedView[] = [];
    const query = {
      projectId: f.project.id,
      sort: "key_asc" as const,
      mode: "list" as const,
    };
    const view = render(
      <SavedViewEditor
        query={query}
        onClose={() => {}}
        onSaved={async (value) => {
          saved.push(value);
          await Promise.resolve();
        }}
      />,
    );
    await f.user.type(screen.getByLabelText("뷰 이름"), "내 검토");
    await f.user.click(screen.getByRole("button", { name: "뷰 저장" }));
    await waitFor(() => {
      assert.equal(saved.length, 1);
    });
    await f.user.click(screen.getByRole("button", { name: "뷰 저장" }));
    await screen.findByRole("alert");
    assert.equal(
      screen.getByLabelText<HTMLInputElement>("뷰 이름").value,
      "내 검토",
    );
    const original = saved[0];
    assert.ok(original);
    cleanup();
    f.instance.store.views.update(sessionOwner, original.id, {
      revision: 1,
      name: "외부 수정",
      query,
    });
    render(
      <SavedViewEditor
        view={original}
        query={query}
        onClose={() => {}}
        onSaved={async () => {}}
      />,
    );
    await f.user.clear(screen.getByLabelText("뷰 이름"));
    await f.user.type(screen.getByLabelText("뷰 이름"), "내 변경");
    await f.user.click(screen.getByRole("button", { name: "뷰 저장" }));
    await screen.findByRole("alert");
    assert.equal(
      screen.getByLabelText<HTMLInputElement>("뷰 이름").value,
      "내 변경",
    );
    assert.equal(
      f.instance.store.views.get(sessionOwner, original.id).name,
      "외부 수정",
    );
    view.unmount();
  } finally {
    await f.dispose();
  }
});
void test("filters distinguish all version roles and support removable keyboard chips", async () => {
  const f = await fixture();
  try {
    const { IssueFilters } =
      await import("../../client/features/views/IssueFilters.js");
    const version = f.instance.store.createVersion(sessionOwner, {
      projectId: f.project.id,
      name: "v1",
    });
    const data = f.instance.store.bootstrap(sessionOwner);
    function Probe() {
      const [query, setQuery] = React.useState<
        import("../../server/contracts/issue-query.js").IssueQuery
      >({ projectId: f.project.id, mode: "board", sort: "key_asc" });
      return (
        <>
          <IssueFilters data={data} query={query} onChange={setQuery} />
          <output>{JSON.stringify(query)}</output>
        </>
      );
    }
    const view = render(<Probe />);
    await f.user.selectOptions(
      screen.getByLabelText("발견 버전 필터"),
      version.id,
    );
    await f.user.selectOptions(
      screen.getByLabelText("수정 버전 필터"),
      version.id,
    );
    assert.match(view.container.textContent, /foundVersionId/);
    assert.match(view.container.textContent, /fixedVersionId/);
    await f.user.type(screen.getByLabelText("라벨 필터"), "bug, swift");
    await f.user.tab();
    assert.match(view.container.textContent, /"labels":\["bug","swift"\]/);

    screen.getByRole("button", { name: "발견 버전 필터 제거" }).focus();
    await f.user.keyboard("{Enter}");
    assert.equal(
      screen.getByLabelText<HTMLSelectElement>("발견 버전 필터").value,
      "",
    );
    assert.equal(
      screen.getByLabelText<HTMLSelectElement>("수정 버전 필터").value,
      version.id,
    );
  } finally {
    await f.dispose();
  }
});
void test("saved workspace restores predicates, retains conflicting drafts, and favorites/default survive remount", async () => {
  const f = await fixture();
  try {
    const { SavedIssueWorkspace } =
      await import("../../client/features/views/SavedIssueWorkspace.js");
    const { SavedViewNavigation } =
      await import("../../client/features/views/SavedViewNavigation.js");
    const data = f.instance.store.bootstrap(sessionOwner);
    const saved = f.instance.store.views.create(sessionOwner, {
      name: "입력 작업",
      query: {
        projectId: f.project.id,
        query: "입력",
        sort: "key_asc",
        mode: "list",
      },
    });
    const select = () => {};
    const changed = () => {};
    const view = render(
      <>
        <SavedViewNavigation
          projectId={f.project.id}
          selectedId={saved.id}
          refreshToken={0}
          onSelect={select}
          onChanged={changed}
        />
        <SavedIssueWorkspace
          data={data}
          projectId={f.project.id}
          viewId={saved.id}
          onSelect={select}
          onChanged={changed}
          onNew={() => {}}
          relations={{}}
          relationStale={false}
          onOpen={() => {}}
        />
      </>,
    );
    await waitFor(() => {
      assert.equal(
        screen.getByLabelText<HTMLInputElement>("이슈 검색").value,
        "입력",
      );
    });
    await screen.findByText(f.issue.title);
    await f.user.click(
      screen.getByRole("button", { name: "입력 작업 즐겨찾기" }),
    );
    await waitFor(() => {
      assert.equal(
        screen
          .getByRole("button", { name: "입력 작업 즐겨찾기" })
          .getAttribute("aria-pressed"),
        "true",
      );
    });
    await f.user.selectOptions(screen.getByLabelText("기본 뷰"), saved.id);
    await waitFor(() => {
      assert.equal(
        f.instance.store.views.preferences(sessionOwner, f.project.id)
          .defaultViewId,
        saved.id,
      );
    });
    await f.user.type(screen.getByLabelText("이슈 검색"), " draft");
    assert.ok(screen.getByText("저장되지 않음"));
    view.unmount();
    render(
      <SavedViewNavigation
        projectId={f.project.id}
        selectedId={saved.id}
        refreshToken={0}
        onSelect={select}
        onChanged={changed}
      />,
    );
    await waitFor(() => {
      assert.equal(
        screen.getByLabelText<HTMLSelectElement>("기본 뷰").value,
        saved.id,
      );
    });
    assert.equal(
      screen
        .getByRole("button", { name: "입력 작업 즐겨찾기" })
        .getAttribute("aria-pressed"),
      "true",
    );
  } finally {
    await f.dispose();
  }
});
void test("missing saved view never falls back to unfiltered issues; default applies only once per project entry", async () => {
  const f = await fixture();
  try {
    const { SavedIssueWorkspace } =
      await import("../../client/features/views/SavedIssueWorkspace.js");
    const data = f.instance.store.bootstrap(sessionOwner);
    const saved = f.instance.store.views.create(sessionOwner, {
      name: "기본",
      query: { projectId: f.project.id, status: ["done"] },
    });
    f.instance.store.views.setPreferences(sessionOwner, f.project.id, {
      revision: 0,
      defaultViewId: saved.id,
      favoriteIds: [],
    });
    const selections: string[] = [];
    const select = (id: string) => {
      selections.push(id);
    };
    const props = {
      data,
      projectId: f.project.id,
      onSelect: select,
      onChanged: () => {},
      onNew: () => {},
      relations: {},
      relationStale: false,
      onOpen: () => {},
    };
    const view = render(<SavedIssueWorkspace {...props} viewId="missing" />);
    await screen.findByRole("alert");
    assert.equal(screen.queryByText(f.issue.title), null);
    assert.equal(screen.queryByLabelText("이슈 검색"), null);
    view.unmount();
    const second = render(<SavedIssueWorkspace {...props} viewId="" />);
    await waitFor(() => {
      assert.deepEqual(selections, [saved.id]);
    });
    second.rerender(<SavedIssueWorkspace {...props} viewId={saved.id} />);
    await screen.findByLabelText("이슈 검색");
    second.rerender(<SavedIssueWorkspace {...props} viewId="" />);
    await screen.findByLabelText("이슈 검색");
    assert.deepEqual(selections, [saved.id]);
  } finally {
    await f.dispose();
  }
});
void test("confirmed save remains authoritative when the following GET fails", async () => {
  const f = await fixture();
  const transport = globalThis.fetch;
  let offline = false;
  const saved = f.instance.store.views.create(sessionOwner, {
    name: "원래 뷰",
    query: { projectId: f.project.id, query: "원래 조건" },
  });
  globalThis.fetch = async (input, init = {}) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (
      offline &&
      path.endsWith(`/views/${saved.id}`) &&
      (!init.method || init.method === "GET")
    )
      throw new Error("view refresh offline");
    const response = await transport(input, init);
    if (init.method === "PATCH" && response.ok) offline = true;
    return response;
  };
  try {
    const { SavedIssueWorkspace } =
      await import("../../client/features/views/SavedIssueWorkspace.js");
    const props = {
      projectId: f.project.id,
      viewId: saved.id,
      onSelect: () => {},
      onChanged: () => {},
      onNew: () => {},
      relations: {},
      relationStale: false,
      onOpen: () => {},
    };
    const view = render(
      <SavedIssueWorkspace
        {...props}
        data={f.instance.store.bootstrap(sessionOwner)}
      />,
    );
    await screen.findByLabelText("이슈 검색");
    await f.user.clear(screen.getByLabelText("이슈 검색"));
    await f.user.type(screen.getByLabelText("이슈 검색"), "확정 조건");
    await f.user.click(screen.getByRole("button", { name: "이름 변경" }));
    await f.user.clear(screen.getByLabelText("뷰 이름"));
    await f.user.type(screen.getByLabelText("뷰 이름"), "확정 뷰");
    const { within } = await import("@testing-library/react");
    await f.user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "뷰 저장",
      }),
    );
    await waitFor(() => {
      assert.ok(screen.queryByRole("dialog") === null);
    });
    view.rerender(
      <SavedIssueWorkspace
        {...props}
        data={f.instance.store.bootstrap(sessionOwner)}
      />,
    );
    await screen.findByText("view refresh offline");
    assert.ok(screen.queryByText("새 버전 있음") === null);
    assert.equal(
      screen.getByRole("heading", { level: 2 }).textContent,
      "확정 뷰",
    );
    assert.equal(
      screen.getByLabelText<HTMLInputElement>("이슈 검색").value,
      "확정 조건",
    );
    assert.equal(
      f.instance.store.views.get(sessionOwner, saved.id).revision,
      2,
    );
  } finally {
    await f.dispose();
  }
});
void test("compact saved view menu closes after selection and Escape with focus returned", async () => {
  const f = await fixture();
  try {
    const { SavedViewNavigation } =
      await import("../../client/features/views/SavedViewNavigation.js");
    const saved = f.instance.store.views.create(sessionOwner, {
        name: "모바일 뷰",
        query: { projectId: f.project.id },
      }),
      selected: string[] = [];
    render(
      <SavedViewNavigation
        projectId={f.project.id}
        selectedId=""
        refreshToken={0}
        onSelect={(id) => {
          selected.push(id);
        }}
        onChanged={() => {}}
      />,
    );
    const toggle = screen.getByRole("button", { name: "저장한 뷰 펼치기" });
    await f.user.click(toggle);
    await f.user.click(
      await screen.findByRole("button", { name: "모바일 뷰" }),
    );
    assert.deepEqual(selected, [saved.id]);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, toggle);
    await f.user.keyboard("{Enter}");
    screen.getByRole("button", { name: "모바일 뷰 즐겨찾기" }).focus();
    await f.user.keyboard("{Escape}");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, toggle);
  } finally {
    await f.dispose();
  }
});
void test("create and copy hand off confirmed snapshots to new view routes even if reads fail", async () => {
  const f = await fixture(),
    transport = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => {
    if (
      /\/views\/[^/?]+$/.test(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      ) &&
      (!init.method || init.method === "GET")
    )
      return Promise.reject(new Error("new view read offline"));
    return transport(input, init);
  };
  try {
    const { SavedIssueWorkspace } =
      await import("../../client/features/views/SavedIssueWorkspace.js");
    const { within } = await import("@testing-library/react");
    const data = f.instance.store.bootstrap(sessionOwner);
    function Probe() {
      const [id, setId] = React.useState("");
      return (
        <SavedIssueWorkspace
          data={data}
          projectId={f.project.id}
          viewId={id}
          onSelect={setId}
          onChanged={() => {}}
          onNew={() => {}}
          relations={{}}
          relationStale={false}
          onOpen={() => {}}
        />
      );
    }
    render(<Probe />);
    await screen.findByLabelText("이슈 검색");
    await f.user.type(screen.getByLabelText("이슈 검색"), "입력");
    await f.user.click(screen.getByRole("button", { name: "새 뷰 저장" }));
    await f.user.type(screen.getByLabelText("뷰 이름"), "새 확정 뷰");
    await f.user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "뷰 저장",
      }),
    );
    await screen.findByText("new view read offline");
    assert.equal(
      screen.getByLabelText<HTMLInputElement>("이슈 검색").value,
      "입력",
    );
    assert.equal(
      screen.getByRole("heading", { level: 2 }).textContent,
      "새 확정 뷰",
    );
    await f.user.click(screen.getByRole("button", { name: "뷰 복제" }));
    await f.user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "뷰 저장",
      }),
    );
    await screen.findByText("new view read offline");
    assert.equal(
      screen.getByLabelText<HTMLInputElement>("이슈 검색").value,
      "입력",
    );
    assert.equal(
      screen.getByRole("heading", { level: 2 }).textContent,
      "새 확정 뷰 복제",
    );
    assert.equal(
      f.instance.store.views.list(sessionOwner, f.project.id).length,
      2,
    );
  } finally {
    await f.dispose();
  }
});
