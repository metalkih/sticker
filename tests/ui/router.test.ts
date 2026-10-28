import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readRoute } from "../../client/router.js";
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
  } finally {
    dom.window.close();
    Reflect.deleteProperty(globalThis, "window");
  }
});
