export interface Route {
  section: string;
  project: string;
  issue: string;
  session: string;
  request: string;
}
export const readRoute = (): Route => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const rawSession = params.get("session") || "",
    rawRequest = params.get("request") || "",
    issue = params.get("issue") || "";
  const section =
    params.get("section") ||
    (rawSession ? "agents" : rawRequest ? "inbox" : "issues");
  return {
    section,
    project: params.get("project") || "",
    issue,
    session: section === "agents" && !issue ? rawSession : "",
    request: section === "inbox" && !issue ? rawRequest : "",
  };
};
export function navigate(next: Partial<Route>) {
  const merged = { ...readRoute(), ...next };
  if (next.section && next.section !== readRoute().section) {
    merged.session = next.session ?? "";
    merged.request = next.request ?? "";
  }
  const params = new URLSearchParams();
  Object.entries(merged).forEach(([key, value]) => {
    if (value && !(key === "section" && value === "issues"))
      params.set(key, value);
  });
  window.location.hash = params.toString();
}
