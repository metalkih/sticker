import type { Express } from "express";
import type { ReleaseService } from "../features/releases.js";
import { requestActor as actor, requestId as id } from "../http-context.js";
export function registerReleaseRoutes(app: Express, releases: ReleaseService) {
  app.get("/api/versions/:id/readiness", (req, res) =>
    res.json(releases.readiness(actor(req), id(req))),
  );
  app.post("/api/versions/:id/carryover/preview", (req, res) =>
    res.json(releases.previewCarryover(actor(req), id(req), req.body)),
  );
  app.post("/api/versions/:id/carryover", (req, res) =>
    res.json(releases.carryover(actor(req), id(req), req.body)),
  );
  app.get("/api/versions/:id/changelog", (req, res) =>
    res.json(releases.changelog(actor(req), id(req))),
  );
  app.put("/api/versions/:id/changelog", (req, res) =>
    res.json(releases.saveChangelog(actor(req), id(req), req.body)),
  );
  app.post("/api/versions/:id/changelog/generate", (req, res) =>
    res.json(releases.generateChangelog(actor(req), id(req), req.body)),
  );
  app.get("/api/versions/:id/changelog/export", (req, res) => {
    const draft = releases.changelog(actor(req), id(req));
    res
      .set({
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": "attachment; filename=changelog.md",
      })
      .send(draft.markdown);
  });
  app.post("/api/versions/:id/release", (req, res) =>
    res.json(releases.release(actor(req), id(req), req.body)),
  );
}
