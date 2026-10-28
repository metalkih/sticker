import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readRoute, navigate } from "../../client/router.js";
void test("bare session/request deep links infer their screen and unrelated explicit sections never retain invisible modal IDs", () => {
  const dom = new JSDOM("", { url: "http://localhost/#session=run" });
  Object.defineProperty(globalThis, "window", {
    value: dom.window,
    configurable: true,
  });
  try {
    assert.equal(readRoute().section, "agents");
    assert.equal(readRoute().session, "run");
    dom.window.location.hash = "request=q";
    assert.equal(readRoute().section, "inbox");
    dom.window.location.hash = "section=issues&session=run&request=q";
    assert.equal(readRoute().session, "");
    assert.equal(readRoute().request, "");
    dom.window.location.hash = "section=agents&session=run&issue=i";
    assert.equal(readRoute().session, "");
    assert.equal(readRoute().issue, "i");
    dom.window.location.hash = "version=v&project=p&tab=found&bucket=all";
    assert.equal(readRoute().section, "versions");
    assert.equal(readRoute().version, "v");
    assert.equal(readRoute().tab, "found");
    dom.window.location.hash =
      "section=versions&version=v&tab=fixed&bucket=done&issue=i";
    assert.equal(readRoute().version, "v");
    assert.equal(readRoute().tab, "fixed");
    assert.equal(readRoute().bucket, "done");
    dom.window.location.hash = "section=issues&version=v&tab=fixed";
    assert.equal(readRoute().version, "");
    dom.window.location.hash = "project=p&view=v";
    assert.equal(readRoute().view, "v");
    navigate({ issue: "i" });
    assert.equal(readRoute().view, "v");
    navigate({ project: "other" });
    assert.equal(readRoute().view, "");
    navigate({ project: "p", view: "v" });
    navigate({ section: "agents" });
    assert.equal(readRoute().view, "");
    dom.window.location.hash = "project=p&template=t";
    assert.equal(readRoute().section, "templates");
    assert.equal(readRoute().template, "t");
    navigate({ section: "issues" });
    assert.equal(readRoute().template, "");
    navigate({ section: "templates", template: "t" });
    navigate({ project: "q" });
    assert.equal(readRoute().template, "");
    dom.window.location.hash = "project=p&resource=r&resourceVersion=2";
    assert.equal(readRoute().section, "resources");
    assert.equal(readRoute().resource, "r");
    assert.equal(readRoute().resourceVersion, "2");
    navigate({ project: "q" });
    assert.equal(readRoute().resource, "");
    assert.equal(readRoute().resourceVersion, "");
    navigate({
      section: "resources",
      resource: "r",
      resourceScope: "v",
      resourceVersion: "1",
    });
    navigate({ section: "issues" });
    assert.equal(readRoute().resource, "");
    assert.equal(readRoute().resourceScope, "");
    dom.window.location.hash =
      "section=resources&resource=r&resourceVersion=bad";
    assert.equal(readRoute().resourceVersion, "");
  } finally {
    dom.window.close();
    Reflect.deleteProperty(globalThis, "window");
  }
});
void test(
  "registered route guards cancel programmatic navigation and preserve retryable Back/Forward entries",
  { timeout: 10000 },
  async () => {
    const dom = new JSDOM("", {
      url: "http://localhost/#section=versions&project=p",
    });
    Object.defineProperty(globalThis, "window", {
      value: dom.window,
      configurable: true,
    });
    const { subscribeRoute, registerRouteGuard, navigate } =
      await import("../../client/router.js");
    let current = readRoute(),
      allowed = false,
      calls = 0;
    const off = subscribeRoute((next) => {
      current = next;
    });
    const until = (check: () => boolean) =>
      new Promise<void>((resolve) => {
        const handler = () => {
          if (check()) {
            dom.window.removeEventListener("hashchange", handler);
            resolve();
          }
        };
        dom.window.addEventListener("hashchange", handler);
      });
    let unguard: () => void = () => undefined;
    try {
      const opened = until(() => current.version === "v");
      navigate({ version: "v", tab: "target", bucket: "all" });
      await opened;
      const detailHash = dom.window.location.hash;
      unguard = registerRouteGuard(() => {
        calls++;
        return allowed;
      });
      navigate({ section: "issues" });
      assert.equal(calls, 1);
      assert.equal(dom.window.location.hash, detailHash);
      const rejectedBack = until(
        () => dom.window.location.hash === detailHash && calls === 2,
      );
      dom.window.history.back();
      await rejectedBack;
      assert.equal(current.version, "v");
      allowed = true;
      const acceptedBack = until(() => current.version === "");
      dom.window.history.back();
      await acceptedBack;
      assert.equal(calls, 3);
      allowed = false;
      const rejectedForward = until(
        () =>
          current.version === "" &&
          dom.window.location.hash !== detailHash &&
          calls === 4,
      );
      dom.window.history.forward();
      await rejectedForward;
      allowed = true;
      const acceptedForward = until(() => current.version === "v");
      dom.window.history.forward();
      await acceptedForward;
      assert.equal(calls, 5);
      const acceptedPush = until(() => current.section === "issues");
      navigate({ section: "issues" });
      await acceptedPush;
      assert.equal(calls, 6, "Accepted programmatic navigation asks only once");
    } finally {
      unguard();
      off();
      dom.window.close();
      Reflect.deleteProperty(globalThis, "window");
    }
  },
);
