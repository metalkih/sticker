import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { lockBodyScroll } from "../../client/scroll-lock.js";

void test("shared scroll locks restore the first value regardless of release order and tolerate repeated release", () => {
  for (const reverse of [false, true]) {
    const document = new JSDOM("<!doctype html><body></body>").window.document;
    document.body.style.overflow = "scroll";
    const first = lockBodyScroll(document);
    const second = lockBodyScroll(document);
    const releases = reverse ? [second, first] : [first, second];
    assert.equal(document.body.style.overflow, "hidden");
    releases[0]();
    releases[0]();
    assert.equal(document.body.style.overflow, "hidden");
    releases[1]();
    assert.equal(document.body.style.overflow, "scroll");
    releases[1]();
    assert.equal(document.body.style.overflow, "scroll");
  }
});

void test("scroll locks are isolated per document and can be reacquired after teardown", () => {
  const a = new JSDOM("<!doctype html><body></body>").window.document;
  const b = new JSDOM("<!doctype html><body></body>").window.document;
  b.body.style.overflow = "auto";
  const releaseA = lockBodyScroll(a);
  const releaseB = lockBodyScroll(b);
  releaseA();
  assert.equal(a.body.style.overflow, "");
  assert.equal(b.body.style.overflow, "hidden");
  releaseB();
  assert.equal(b.body.style.overflow, "auto");
  a.body.style.overflow = "scroll";
  lockBodyScroll(a)();
  assert.equal(a.body.style.overflow, "scroll");
});
