import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sessionHttpFixture } from "./session-fixture.js";
import { readJson } from "./helpers.js";
import { issueSchema, apiErrorSchema } from "../server/response-schemas.js";
import {
  templateDetailSchema,
  issueTemplateSchema,
  templateAssigneeSchema,
  templatePreviewSchema,
  validateTemplateValues,
} from "../server/contracts/templates.js";
void test("HTTP template routes enforce auth/scope/owner CAS and share exact required errors with normal issue creation", async () => {
  const f = await sessionHttpFixture();
  try {
    const path = `/projects/${f.project.id}/templates`,
      definition = {
        name: "에이전트",
        body: "## 작업",
        requiredFields: ["input", "constraints", "verification"],
        defaults: { assignee: "agent", priority: "high" },
        operationId: randomUUID(),
      };
    assert.equal((await f.call(path, "anonymous")).status, 401);
    assert.equal((await f.call(path, "agent", "POST", definition)).status, 403);
    assert.equal((await f.call(path, "read", "POST", definition)).status, 403);
    const response = await f.call(path, "owner", "POST", definition);
    assert.equal(response.status, 201);
    const created = await readJson(response, templateDetailSchema);
    assert.equal(
      (await readJson(await f.call(path, "agent"), issueTemplateSchema.array()))
        .length,
      1,
    );
    assert.equal(
      (await f.call(`/projects/${f.other.id}/templates`, "agent")).status,
      403,
    );
    const directory = await readJson(
      await f.call(`/projects/${f.project.id}/template-assignees`, "agent"),
      templateAssigneeSchema.array(),
    );
    assert.ok(directory.some((actor) => actor.id === "agent"));
    assert.equal(JSON.stringify(directory).includes("tokenHash"), false);
    const preview = await readJson(
      await f.call(
        `/templates/${created.template.id}/preview`,
        "read",
        "POST",
        { values: {} },
      ),
      templatePreviewSchema,
    );
    assert.deepEqual(
      preview.errors,
      validateTemplateValues(["input", "constraints", "verification"], {}),
    );
    const input = {
      projectId: f.project.id,
      title: "필수 검증",
      templateId: created.template.id,
      templateVersion: 1,
      templateValues: {},
    };
    const missing = await f.call("/issues", "agent", "POST", input);
    assert.equal(missing.status, 400);
    const error = await readJson(missing, apiErrorSchema);
    assert.equal(error.code, "TEMPLATE_REQUIRED");
    assert.deepEqual(error.fields, preview.errors);
    const values = {
      input: "입력",
      constraints: "자동 실행 없음",
      verification: "검증",
    };
    const issue = await readJson(
      await f.call("/issues", "agent", "POST", {
        ...input,
        templateValues: values,
        operationId: randomUUID(),
      }),
      issueSchema,
    );
    assert.equal(issue.templateId, created.template.id);
    assert.equal(issue.templateVersion, 1);
    assert.equal(issue.priority, "high");
    assert.ok(issue.description.includes("## 제약"));
    assert.equal(
      (
        await f.call("/issues", "read", "POST", {
          ...input,
          templateValues: values,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call(`/templates/${created.template.id}`, "agent", "PATCH", {
          ...definition,
          revision: 1,
        })
      ).status,
      403,
    );
    const updated = await readJson(
      await f.call(`/templates/${created.template.id}`, "owner", "PATCH", {
        name: "개정",
        body: "다음",
        requiredFields: [],
        defaults: {},
        revision: 1,
      }),
      templateDetailSchema,
    );
    assert.equal(updated.template.currentVersion, 2);
    assert.equal(
      (
        await f.call(`/templates/${created.template.id}`, "owner", "PATCH", {
          name: "충돌",
          body: "x",
          requiredFields: [],
          defaults: {},
          revision: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.call(`/templates/${created.template.id}`, "owner", "DELETE", {
          revision: 2,
        })
      ).status,
      204,
    );
    assert.equal(
      (await f.call(`/templates/${created.template.id}`, "owner")).status,
      404,
    );
    const preserved = await f.call(`/issues/${issue.id}`, "agent");
    assert.equal(preserved.status, 200);
  } finally {
    await f.close();
  }
});
