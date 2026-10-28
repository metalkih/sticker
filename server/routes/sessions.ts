import type { Express } from "express";
import type { SessionService } from "../features/sessions.js";
import {
  requestActor as actor,
  requestId as id,
  queryProject,
} from "../http-context.js";
export function registerSessionRoutes(app: Express, sessions: SessionService) {
  app.get("/api/sessions", (req, res) =>
    res.json(sessions.list(actor(req), queryProject(req))),
  );
  app.get("/api/sessions/:id", (req, res) =>
    res.json(sessions.get(actor(req), id(req))),
  );
  app.post("/api/sessions/events", (req, res) =>
    res.status(201).json(sessions.report(actor(req), req.body)),
  );
  app.get("/api/requests/:id", (req, res) =>
    res.json(sessions.getRequest(actor(req), id(req))),
  );
  app.get("/api/inbox", (req, res) =>
    res.json(
      sessions.inbox(
        actor(req),
        queryProject(req),
        req.query.completed === "true",
      ),
    ),
  );
  app.post("/api/requests/:id/responses", (req, res) =>
    res.json(sessions.respond(actor(req), id(req), req.body)),
  );
  app.post("/api/requests/:id/close", (req, res) =>
    res.json(sessions.closeRequest(actor(req), id(req), req.body)),
  );
  app.post("/api/sessions/:id/close", (req, res) =>
    res.json(sessions.closeSession(actor(req), id(req), req.body)),
  );
}
