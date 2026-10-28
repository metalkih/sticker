import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store, DomainError } from "../server/domain.js";
import type { Actor } from "../server/types.js";
import {
  validateTemplateValues,
  renderTemplate,
} from "../server/contracts/templates.js";
const owner: Actor = {
  id: "owner",
  name: "나",
  role: "owner",
  canWrite: true,
  projectIds: null,
};
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "sticker-template-apply-"));
  const seed = new Store(dir),
    p = seed.createProject(owner, { key: "AP", name: "적용" }),
    q = seed.createProject(owner, { key: "AQ", name: "외부" });
  const version = seed.createVersion(owner, { projectId: p.id, name: "v1" }),
    foreignVersion = seed.createVersion(owner, {
      projectId: q.id,
      name: "foreign",
    });
  seed.close();
  const agent: Actor = {
      id: "agent",
      name: "코딩",
      role: "agent",
      canWrite: true,
      projectIds: [p.id],
    },
    other: Actor = { ...agent, id: "other", projectIds: [q.id] };
  let store = new Store(dir, Date.now, "http://localhost:8787", [
    owner,
    agent,
    other,
  ]);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    p,
    q,
    agent,
    other,
    version,
    foreignVersion,
    reopen() {
      store.close();
      store = new Store(dir, Date.now, "http://localhost:8787", [
        owner,
        agent,
        other,
      ]);
    },
  };
}
function denied(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof DomainError && error.code === code,
  );
}
void test("template creation uses explicit shared required fields and immutable rendered issue provenance", (t) => {
  const f = fixture(t),
    template = f.store.templates.create(owner, {
      projectId: f.p.id,
      name: "에이전트",
      body: "기본 본문",
      requiredFields: ["input", "constraints", "verification"],
      defaults: { priority: "high", assignee: f.agent.id },
      operationId: randomUUID(),
    });
  const base = {
    projectId: f.p.id,
    title: "명시적 요청",
    templateId: template.template.id,
    templateVersion: 1,
    description: "입력/제약/검증이라는 단어만으로는 부족",
  };
  assert.throws(
    () =>
      f.store.createIssue(f.agent, { ...base, templateValues: { input: " " } }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "TEMPLATE_REQUIRED" &&
      JSON.stringify(error.fields) ===
        JSON.stringify(
          validateTemplateValues(["input", "constraints", "verification"], {
            input: " ",
          }),
        ),
  );
  const values = {
      input: "원본",
      constraints: "승인 전 실행 금지",
      verification: "테스트",
    },
    body = "사용자가 편집한 본문";
  const issue = f.store.createIssue(f.agent, {
    ...base,
    description: body,
    templateValues: values,
    operationId: randomUUID(),
  });
  assert.equal(issue.description, renderTemplate(body, values));
  assert.equal(issue.templateId, template.template.id);
  assert.equal(issue.templateVersion, 1);
  assert.equal(issue.priority, "high");
  assert.equal(issue.assignee, f.agent.id);
  assert.equal(issue.status, "backlog");
  const changed = f.store.templates.update(owner, template.template.id, {
    revision: 1,
    name: "다음 버전",
    body: "변경 본문",
    requiredFields: [],
    defaults: { priority: "low" },
  });
  assert.equal(changed.template.currentVersion, 2);
  f.store.templates.remove(owner, template.template.id, { revision: 2 });
  f.reopen();
  const persisted = f.store.getIssue(owner, issue.id).issue;
  assert.equal(persisted.description, issue.description);
  assert.equal(persisted.templateId, template.template.id);
  assert.equal(persisted.templateVersion, 1);
  assert.equal(f.store.sessions.list(owner).length, 0);
});
void test("normal create stays compatible while template application revalidates safe defaults, scope and current references", (t) => {
  const f = fixture(t),
    template = f.store.templates.create(owner, {
      projectId: f.p.id,
      name: "버그",
      body: "## 버그",
      requiredFields: ["foundVersionId"],
      defaults: { foundVersionId: f.version.id, status: "ready" },
      operationId: randomUUID(),
    });
  const base = {
    projectId: f.p.id,
    title: "보고",
    templateId: template.template.id,
    templateVersion: 1,
    templateValues: { foundVersionId: f.version.id },
  };
  const issue = f.store.createIssue(f.agent, {
    ...base,
    operationId: randomUUID(),
  });
  assert.equal(issue.status, "ready");
  assert.equal(issue.foundVersionId, f.version.id);
  assert.ok(issue.description.includes("v1"));
  denied(
    () => f.store.createIssue(f.agent, { ...base, assignee: f.other.id }),
    "TEMPLATE_ASSIGNEE",
  );
  denied(
    () =>
      f.store.createIssue(f.agent, {
        ...base,
        templateValues: { foundVersionId: f.foreignVersion.id },
      }),
    "TEMPLATE_VERSION_REFERENCE",
  );
  denied(
    () =>
      f.store.createIssue(f.agent, {
        ...base,
        targetVersionId: f.foreignVersion.id,
      }),
    "TEMPLATE_VERSION_REFERENCE",
  );
  denied(() => f.store.createIssue(f.other, base), "PROJECT_SCOPE");
  denied(
    () => f.store.createIssue({ ...f.agent, canWrite: false }, base),
    "READ_ONLY",
  );
  f.store.deleteVersion(owner, f.version.id);
  denied(
    () => f.store.createIssue(f.agent, base),
    "TEMPLATE_VERSION_REFERENCE",
  );
  const ordinary = f.store.createIssue(f.agent, {
    projectId: f.p.id,
    title: "일반 이슈",
    description: "원래 본문",
    assignee: "자유 텍스트",
  });
  assert.equal(ordinary.description, "원래 본문");
  assert.equal(ordinary.assignee, "자유 텍스트");
  assert.equal(ordinary.templateId, null);
  assert.equal(ordinary.templateVersion, null);
});
void test("template-version conflicts retain intent and create operation retries cannot duplicate or grant current scope", (t) => {
  const f = fixture(t),
    template = f.store.templates.create(owner, {
      projectId: f.p.id,
      name: "기능",
      body: "본문",
      requiredFields: ["problem"],
      defaults: { status: "ready" },
      operationId: randomUUID(),
    });
  const input = {
    projectId: f.p.id,
    title: "한 번만 생성",
    templateId: template.template.id,
    templateVersion: 1,
    templateValues: { problem: "문제" },
    operationId: randomUUID(),
  };
  const first = f.store.createIssue(f.agent, input);
  f.store.templates.update(owner, template.template.id, {
    revision: 1,
    name: "v2",
    body: "새 본문",
    requiredFields: ["acceptance"],
    defaults: {},
  });
  assert.equal(f.store.createIssue(f.agent, input).id, first.id);
  denied(
    () => f.store.createIssue(f.agent, { ...input, title: "다른 요청" }),
    "OPERATION_CONFLICT",
  );
  denied(
    () => f.store.createIssue({ ...f.agent, projectIds: [] }, input),
    "PROJECT_SCOPE",
  );
  denied(
    () => f.store.createIssue(f.agent, { ...input, operationId: randomUUID() }),
    "TEMPLATE_VERSION_CONFLICT",
  );
  assert.equal(f.store.bootstrap(owner).issues.length, 1);
  f.reopen();
  assert.equal(f.store.createIssue(f.agent, input).id, first.id);
});
void test("template metadata cannot be forged onto ordinary creation or altered through issue PATCH", (t) => {
  const f = fixture(t);
  for (const extra of [
    { templateVersion: 1 },
    { templateValues: { input: "x" } },
    { templateId: "missing" },
    { templateId: "missing", templateVersion: "1" },
  ])
    denied(
      () =>
        f.store.createIssue(owner, {
          projectId: f.p.id,
          title: "위조",
          ...extra,
        }),
      "VALIDATION",
    );
  const issue = f.store.createIssue(owner, {
    projectId: f.p.id,
    title: "일반",
  });
  denied(
    () =>
      f.store.updateIssue(owner, issue.id, {
        revision: issue.revision,
        templateId: "forged",
        templateVersion: 1,
      }),
    "VALIDATION",
  );
});
void test("create replay cannot resurrect an explicitly deleted issue", (t) => {
  const f = fixture(t),
    input = {
      projectId: f.p.id,
      title: "삭제할 이슈",
      operationId: randomUUID(),
    };
  const issue = f.store.createIssue(f.agent, input);
  f.store.deleteIssue(owner, issue.id);
  denied(() => f.store.createIssue(f.agent, input), "OPERATION_TARGET_GONE");
  assert.equal(f.store.bootstrap(owner).issues.length, 0);
});
void test("templated creates require an operation UUID after actionable field validation", (t) => {
  const f = fixture(t),
    template = f.store.templates.create(owner, {
      projectId: f.p.id,
      name: "중복 방지",
      body: "본문",
      requiredFields: [],
      defaults: {},
      operationId: randomUUID(),
    });
  denied(
    () =>
      f.store.createIssue(f.agent, {
        projectId: f.p.id,
        title: "반복 클릭",
        templateId: template.template.id,
        templateVersion: 1,
        templateValues: {},
      }),
    "OPERATION_REQUIRED",
  );
});
