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
import VersionDetail from "../../client/features/releases/VersionDetail.js";
function ReleaseScreen({
  id,
  data,
  onOpenIssue,
  onBack,
}: {
  id: string;
  data: ReturnType<import("../../server/domain.js").Store["bootstrap"]>;
  onOpenIssue: (id: string) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = React.useState("target"),
    [bucket, setBucket] = React.useState("all");
  return (
    <VersionDetail
      id={id}
      data={data}
      tab={tab}
      bucket={bucket}
      onTab={setTab}
      onBucket={setBucket}
      onOpenIssue={onOpenIssue}
      onBack={onBack}
      onChanged={() => undefined}
    />
  );
}
async function setup() {
  const f = await sessionHttpFixture(),
    user = userEvent.setup({ document: dom.window.document });
  const login = await nativeFetch(`${f.base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "disposable-session-owner-password" }),
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  let offline = false;
  globalThis.fetch = (input, init = {}) => {
    if (offline) return Promise.reject(new Error("offline fixture"));
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
  const version = f.instance.store.createVersion(sessionOwner, {
    projectId: f.project.id,
    name: "v1",
  });
  return {
    f,
    user,
    version,
    setOffline: (value: boolean) => {
      offline = value;
    },
    close: async () => {
      cleanup();
      globalThis.fetch = nativeFetch;
      await f.close();
    },
  };
}
void test("version detail exposes three roles, count filters, empty scope and retained failed-refresh feedback", async () => {
  const s = await setup();
  try {
    s.f.instance.store.updateIssue(sessionOwner, s.f.issue.id, {
      revision: 1,
      targetVersionId: s.version.id,
      foundVersionId: s.version.id,
    });
    const done = s.f.instance.store.createIssue(sessionOwner, {
      projectId: s.f.project.id,
      title: "구현된 변경",
      status: "done",
      targetVersionId: s.version.id,
      fixedVersionId: s.version.id,
    });
    let opened = "";
    render(
      <ReleaseScreen
        id={s.version.id}
        data={s.f.instance.store.bootstrap(sessionOwner)}
        onOpenIssue={(id) => {
          opened = id;
        }}
        onBack={() => undefined}
      />,
    );
    await screen.findByRole("heading", { name: "v1", level: 2 });
    await s.user.click(screen.getByRole("button", { name: "구현 완료 1" }));
    assert.equal(
      screen.queryByRole("button", { name: new RegExp(s.f.issue.key + " ·") }),
      null,
    );
    await s.user.click(
      screen.getByRole("button", { name: new RegExp(done.key + " ·") }),
    );
    assert.equal(opened, done.id);
    await s.user.click(screen.getByRole("tab", { name: "발견 1" }));
    assert.ok(
      screen.getByRole("button", { name: new RegExp(s.f.issue.key + " ·") }),
    );
    s.setOffline(true);
    await s.user.click(
      screen.getByRole("button", { name: "버전 상세 새로고침" }),
    );
    await screen.findByText(/이전 기록/);
    assert.ok(screen.getByRole("heading", { name: "v1", level: 2 }));
  } finally {
    await s.close();
  }
});
void test("release review cancellation never moves or releases, draft CAS retains unsaved edits and confirmation is explicit", async () => {
  const s = await setup();
  try {
    s.f.instance.store.updateIssue(sessionOwner, s.f.issue.id, {
      revision: 1,
      targetVersionId: s.version.id,
    });
    s.f.instance.store.createVersion(sessionOwner, {
      projectId: s.f.project.id,
      name: "v2",
    });
    render(
      <ReleaseScreen
        id={s.version.id}
        data={s.f.instance.store.bootstrap(sessionOwner)}
        onOpenIssue={() => undefined}
        onBack={() => undefined}
      />,
    );
    await screen.findByRole("heading", { name: "v1", level: 2 });
    await s.user.click(screen.getByRole("button", { name: "출시 검토" }));
    await screen.findByLabelText("Markdown 변경로그");
    await s.user.click(screen.getByRole("button", { name: "이관 미리보기" }));
    await screen.findByText("이관 가능");
    await s.user.click(screen.getByRole("button", { name: "취소" }));
    assert.equal(
      s.f.instance.store.getIssue(sessionOwner, s.f.issue.id).issue
        .targetVersionId,
      s.version.id,
    );
    assert.equal(
      s.f.instance.store.releases.readiness(sessionOwner, s.version.id).version
        .state,
      "planned",
    );
    await s.user.click(screen.getByRole("button", { name: "출시 검토" }));
    await screen.findByLabelText("Markdown 변경로그");
    await s.user.type(screen.getByLabelText("Markdown 변경로그"), "# 내 초안");
    assert.ok(screen.getByText("저장하지 않은 변경"));
    s.f.instance.store.releases.saveChangelog(sessionOwner, s.version.id, {
      revision: 0,
      selectedIssueIds: [],
      markdown: "다른 변경",
    });
    await s.user.click(screen.getByRole("button", { name: "초안 저장" }));
    await screen.findByRole("alert");
    assert.equal(
      screen.getByLabelText<HTMLTextAreaElement>("Markdown 변경로그").value,
      "# 내 초안",
    );
  } finally {
    await s.close();
  }
});
void test("draft references moved out of the current version remain visible and can be removed without losing Markdown", async () => {
  const s = await setup();
  try {
    const issue = s.f.instance.store.updateIssue(sessionOwner, s.f.issue.id, {
      revision: 1,
      targetVersionId: s.version.id,
    });
    s.f.instance.store.releases.saveChangelog(sessionOwner, s.version.id, {
      revision: 0,
      selectedIssueIds: [issue.id],
      markdown: "보존할 초안",
    });
    const next = s.f.instance.store.createVersion(sessionOwner, {
      projectId: s.f.project.id,
      name: "다음",
    });
    s.f.instance.store.releases.carryover(sessionOwner, s.version.id, {
      revision: 1,
      destinationVersionId: next.id,
      destinationRevision: 1,
      operationId: crypto.randomUUID(),
      issues: [{ issueId: issue.id, revision: issue.revision }],
    });
    render(
      <ReleaseScreen
        id={s.version.id}
        data={s.f.instance.store.bootstrap(sessionOwner)}
        onOpenIssue={() => undefined}
        onBack={() => undefined}
      />,
    );
    await screen.findByRole("button", { name: "출시 검토" });
    await s.user.click(screen.getByRole("button", { name: "출시 검토" }));
    const unavailable = await screen.findByLabelText(
      `현재 범위 밖 이슈 ${issue.id}`,
    );
    await s.user.click(unavailable);
    await s.user.click(screen.getByRole("button", { name: "초안 저장" }));
    await screen.findByText("저장된 초안 r2");
    assert.equal(
      s.f.instance.store.releases.changelog(sessionOwner, s.version.id)
        .markdown,
      "보존할 초안",
    );
    assert.deepEqual(
      s.f.instance.store.releases.changelog(sessionOwner, s.version.id)
        .selectedIssueIds,
      [],
    );
  } finally {
    await s.close();
  }
});
for (const action of ["save", "generate"] as const)
  void test(`successful changelog ${action} remains authoritative when follow-up GET fails`, async () => {
    const s = await setup(),
      oldConfirm = dom.window.confirm;
    dom.window.confirm = () => true;
    try {
      const issue = s.f.instance.store.updateIssue(sessionOwner, s.f.issue.id, {
        revision: 1,
        targetVersionId: s.version.id,
      });
      const Editor = (
        await import("../../client/features/releases/ChangelogEditor.js")
      ).default;
      const connectedFetch = globalThis.fetch;
      globalThis.fetch = async (input, init = {}) => {
        const response = await connectedFetch(input, init);
        const path =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (
          response.ok &&
          ((action === "save" && init.method === "PUT") ||
            (action === "generate" &&
              init.method === "POST" &&
              path.endsWith("/generate")))
        )
          s.setOffline(true);
        return response;
      };
      render(
        <Editor
          versionId={s.version.id}
          issues={[issue]}
          onDirty={() => undefined}
          onPending={() => undefined}
        />,
      );
      await screen.findByLabelText("Markdown 변경로그");
      if (action === "save") {
        await s.user.type(
          screen.getByLabelText("Markdown 변경로그"),
          "# confirmed draft",
        );
        await s.user.click(screen.getByRole("button", { name: "초안 저장" }));
      } else {
        await s.user.click(
          screen.getByLabelText(`${issue.key} · ${issue.title}`),
        );
        await s.user.click(
          screen.getByRole("button", { name: "선택 이슈로 초안 생성" }),
        );
      }
      await screen.findByText("offline fixture");
      const confirmed = s.f.instance.store.releases.changelog(
        sessionOwner,
        s.version.id,
      );
      assert.equal(confirmed.revision, 1);
      assert.equal(
        screen.getByLabelText<HTMLTextAreaElement>("Markdown 변경로그").value,
        confirmed.markdown,
      );
      assert.ok(
        screen.queryByText("서버 초안 r0") === null,
        "Older r0 must not be offered after confirmed r1",
      );
      assert.ok(
        screen.queryByRole("button", { name: "최신 초안 불러오기" }) === null,
        "No stale latest action",
      );
    } finally {
      dom.window.confirm = oldConfirm;
      await s.close();
    }
  });

void test("browser Back asks before leaving a dirty release draft; dismissal restores route and acceptance leaves", async () => {
  const s = await setup(),
    oldConfirm = dom.window.confirm;
  let prompts = 0;
  try {
    dom.window.history.replaceState(null, "", "/#section=versions");
    const App = (await import("../../client/App.js")).default;
    render(<App />);
    await s.user.click(
      await screen.findByRole("button", { name: "v1 버전 상세" }),
    );
    await s.user.click(
      await screen.findByRole("button", { name: "출시 검토" }),
    );
    await screen.findByLabelText("Markdown 변경로그");
    await s.user.type(
      screen.getByLabelText("Markdown 변경로그"),
      "unsaved navigation draft",
    );
    dom.window.confirm = () => {
      prompts++;
      return false;
    };
    act(() => {
      dom.window.history.back();
    });
    await waitFor(() => {
      assert.equal(prompts, 1);
      assert.ok(dom.window.location.hash.includes(`version=${s.version.id}`));
    });
    assert.equal(
      screen.getByLabelText<HTMLTextAreaElement>("Markdown 변경로그").value,
      "unsaved navigation draft",
    );
    assert.ok(screen.getByRole("dialog"));
    dom.window.confirm = () => {
      prompts++;
      return true;
    };
    act(() => {
      dom.window.history.back();
    });
    await waitFor(() => {
      assert.ok(screen.queryByRole("dialog") === null);
    });
    assert.equal(prompts, 2);
    assert.ok(await screen.findByRole("button", { name: "v1 버전 상세" }));
    assert.equal(
      s.f.instance.store.releases.changelog(sessionOwner, s.version.id)
        .revision,
      0,
    );
  } finally {
    dom.window.confirm = oldConfirm;
    await s.close();
  }
});
