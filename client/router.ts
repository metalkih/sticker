export interface Route {
  section: string;
  project: string;
  issue: string;
  session: string;
  request: string;
  version: string;
  tab: string;
  bucket: string;
  view: string;
  template: string;
  resource: string;
  resourceScope: string;
  resourceVersion: string;
}
export const readRoute = (): Route => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const rawSession = params.get("session") || "",
    rawRequest = params.get("request") || "",
    issue = params.get("issue") || "",
    rawVersion = params.get("version") || "",
    rawTemplate = params.get("template") || "",
    rawResource = params.get("resource") || "";
  const section =
    params.get("section") ||
    (rawSession
      ? "agents"
      : rawRequest
        ? "inbox"
        : rawVersion
          ? "versions"
          : rawResource
            ? "resources"
            : rawTemplate
              ? "templates"
              : "issues");
  return {
    section,
    resource: section === "resources" ? rawResource : "",
    resourceScope:
      section === "resources" ? params.get("resourceScope") || "" : "",
    resourceVersion:
      section === "resources" &&
      rawResource &&
      /^[1-9]\d*$/.test(params.get("resourceVersion") || "")
        ? params.get("resourceVersion") || ""
        : "",
    template: section === "templates" ? rawTemplate : "",
    view: section === "issues" ? params.get("view") || "" : "",
    project: params.get("project") || "",
    issue,
    session: section === "agents" && !issue ? rawSession : "",
    request: section === "inbox" && !issue ? rawRequest : "",
    version: section === "versions" ? rawVersion : "",
    tab:
      section === "versions" && rawVersion ? params.get("tab") || "target" : "",
    bucket:
      section === "versions" && rawVersion ? params.get("bucket") || "all" : "",
  };
};
export type RouteGuard = (next: Route) => boolean;
const routeGuards = new Set<RouteGuard>();
let approvedHash: string | null = null;
export function registerRouteGuard(guard: RouteGuard) {
  routeGuards.add(guard);
  return () => {
    routeGuards.delete(guard);
  };
}
function mayLeave(next: Route) {
  return [...routeGuards].every((guard) => guard(next));
}
function historyIndex(): number | null {
  const state: unknown = window.history.state;
  if (
    state &&
    typeof state === "object" &&
    "__stickerRouteIndex" in state &&
    typeof state.__stickerRouteIndex === "number" &&
    Number.isSafeInteger(state.__stickerRouteIndex)
  )
    return state.__stickerRouteIndex;
  return null;
}
function markHistory(index: number) {
  const state: unknown = window.history.state;
  window.history.replaceState(
    {
      ...(state && typeof state === "object" ? state : {}),
      __stickerRouteIndex: index,
    },
    "",
    window.location.href,
  );
}
/** Decide before rendering a same-document departure; undo rejected Back/Forward without overwriting either entry. */
export function subscribeRoute(listener: (route: Route) => void) {
  let acceptedHash = window.location.hash;
  let acceptedIndex = historyIndex() ?? 0;
  markHistory(acceptedIndex);
  const update = () => {
    const hash = window.location.hash,
      next = readRoute();
    const index = historyIndex() ?? acceptedIndex + 1;
    const approved = approvedHash === hash;
    approvedHash = null;
    if (hash !== acceptedHash && !approved && !mayLeave(next)) {
      window.history.go(acceptedIndex - index || -1);
      return;
    }
    acceptedHash = hash;
    acceptedIndex = index;
    markHistory(index);
    listener(next);
  };
  window.addEventListener("hashchange", update);
  return () => {
    window.removeEventListener("hashchange", update);
    approvedHash = null;
  };
}
export function navigate(next: Partial<Route>) {
  const merged = { ...readRoute(), ...next };
  if (next.section && next.section !== readRoute().section) {
    merged.resource = next.resource ?? "";
    merged.resourceScope = next.resourceScope ?? "";
    merged.resourceVersion = next.resourceVersion ?? "";
    merged.template = next.template ?? "";
    merged.view = next.view ?? "";
    merged.session = next.session ?? "";
    merged.request = next.request ?? "";
    merged.version = next.version ?? "";
    merged.tab = next.tab ?? "";
    merged.bucket = next.bucket ?? "";
  }
  if (next.project !== undefined && next.project !== readRoute().project) {
    merged.view = next.view ?? "";
    merged.resource = next.resource ?? "";
    merged.resourceScope = next.resourceScope ?? "";
    merged.resourceVersion = next.resourceVersion ?? "";
    merged.template = next.template ?? "";
  }
  const params = new URLSearchParams();
  Object.entries(merged).forEach(([key, value]) => {
    if (value && !(key === "section" && value === "issues"))
      params.set(key, value);
  });
  const hash = params.toString();
  const destination = hash ? `#${hash}` : "";
  if (window.location.hash === destination) return;
  if (!mayLeave(merged)) return;
  approvedHash = destination;
  window.location.hash = hash;
}
