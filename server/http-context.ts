import type { Request } from "express";
import type { Actor } from "./types.js";
export const requestActor = (req: Request) =>
  (req as Request & { actor: Actor }).actor;
export const requestId = (req: Request) => String(req.params.id);
export const queryProject = (req: Request) =>
  typeof req.query.projectId === "string" ? req.query.projectId : undefined;
