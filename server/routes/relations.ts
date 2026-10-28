import type { Express } from "express";
import type { RelationService } from "../features/relations.js";
import {
  requestActor as actor,
  requestId as id,
  queryProject,
} from "../http-context.js";
export function registerRelationRoutes(
  app: Express,
  relations: RelationService,
) {
  app.get("/api/relations/summary", (req, res) =>
    res.json(relations.summaries(actor(req), queryProject(req))),
  );
  app.get("/api/issues/:id/relations", (req, res) =>
    res.json(relations.get(actor(req), id(req))),
  );
  app.post("/api/issues/:id/relations", (req, res) =>
    res.status(201).json(relations.add(actor(req), id(req), req.body)),
  );
  app.delete("/api/relations/:id", (req, res) => {
    relations.remove(actor(req), id(req), req.body);
    res.status(204).end();
  });
}
