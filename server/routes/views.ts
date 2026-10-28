import type { Express, Request } from "express";
import type { ViewService } from "../features/views.js";
import {
  requestActor as actor,
  requestId as id,
  queryProject,
} from "../http-context.js";
import { DomainError } from "../domain-error.js";
function getQuery(req: Request): unknown {
  const fields = Object.entries(req.query);
  if (typeof req.query.filter === "string") {
    if (fields.length !== 1 || req.query.filter.length > 10000)
      throw new DomainError(400, "INVALID_INPUT", "필터 형식을 확인하세요.");
    try {
      const input: unknown = JSON.parse(req.query.filter);
      return input;
    } catch {
      throw new DomainError(400, "INVALID_INPUT", "필터 형식을 확인하세요.");
    }
  }
  const input: Record<string, unknown> = {};
  for (const [key, value] of fields) {
    if (typeof value !== "string")
      throw new DomainError(400, "INVALID_INPUT", "필터 형식을 확인하세요.");
    if (["status", "priority", "labels"].includes(key))
      input[key] = value.split(",");
    else if (["blocked", "inputRequested"].includes(key)) {
      if (value !== "true" && value !== "false")
        throw new DomainError(400, "INVALID_INPUT", "필터 형식을 확인하세요.");
      input[key] = value === "true";
    } else input[key] = value;
  }
  return input;
}
export function registerViewRoutes(app: Express, views: ViewService) {
  app.get("/api/views", (req, res) =>
    res.json(views.list(actor(req), queryProject(req))),
  );
  app.post("/api/views", (req, res) =>
    res.status(201).json(views.create(actor(req), req.body)),
  );
  app.get("/api/views/:id", (req, res) =>
    res.json(views.get(actor(req), id(req))),
  );
  app.patch("/api/views/:id", (req, res) =>
    res.json(views.update(actor(req), id(req), req.body)),
  );
  app.delete("/api/views/:id", (req, res) => {
    views.remove(actor(req), id(req), req.body);
    res.status(204).end();
  });
  app.get("/api/view-preferences/:id", (req, res) =>
    res.json(views.preferences(actor(req), id(req))),
  );
  app.put("/api/view-preferences/:id", (req, res) =>
    res.json(views.setPreferences(actor(req), id(req), req.body)),
  );
  app.get("/api/issues", (req, res) =>
    res.json(views.query(actor(req), getQuery(req))),
  );
  app.post("/api/issues/query", (req, res) =>
    res.json(views.query(actor(req), req.body)),
  );
}
