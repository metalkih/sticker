import type { Express } from "express";
import { z } from "zod";
import { DomainError } from "../domain-error.js";
import type { TemplateService } from "../features/templates.js";
import { templateCreateSchema } from "../contracts/templates.js";
import { requestActor, requestId } from "../http-context.js";
const createBody = templateCreateSchema.omit({ projectId: true });
export function registerTemplateRoutes(
  app: Express,
  templates: TemplateService,
) {
  app.get("/api/projects/:id/templates", (req, res) =>
    res.json(templates.list(requestActor(req), requestId(req))),
  );
  app.get("/api/projects/:id/template-assignees", (req, res) =>
    res.json(templates.assignees(requestActor(req), requestId(req))),
  );
  app.post("/api/projects/:id/templates", (req, res) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success)
      throw new DomainError(
        400,
        "VALIDATION",
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      );
    res.status(201).json(
      templates.create(requestActor(req), {
        ...parsed.data,
        projectId: requestId(req),
      }),
    );
  });
  app.get("/api/templates/:id", (req, res) => {
    let version: number | undefined;
    if (req.query.version !== undefined) {
      const parsed = z.coerce
        .number()
        .int()
        .positive()
        .safeParse(req.query.version);
      if (typeof req.query.version !== "string" || !parsed.success)
        throw new DomainError(
          400,
          "VALIDATION",
          "템플릿 버전은 양의 정수여야 합니다.",
        );
      version = parsed.data;
    }
    res.json(templates.get(requestActor(req), requestId(req), version));
  });
  app.patch("/api/templates/:id", (req, res) =>
    res.json(templates.update(requestActor(req), requestId(req), req.body)),
  );
  app.delete("/api/templates/:id", (req, res) => {
    templates.remove(requestActor(req), requestId(req), req.body);
    res.status(204).end();
  });
  app.post("/api/templates/:id/preview", (req, res) =>
    res.json(templates.preview(requestActor(req), requestId(req), req.body)),
  );
}
