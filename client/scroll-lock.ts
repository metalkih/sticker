/** Shared by overlapping panels and dialogs; teardown order must not leak a body lock. */
const locks = new WeakMap<Document, { count: number; previous: string }>();

export function lockBodyScroll(document: Document): () => void {
  let state = locks.get(document);
  if (!state) {
    state = { count: 0, previous: document.body.style.overflow };
    locks.set(document, state);
  }
  state.count += 1;
  document.body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.count -= 1;
    if (state.count === 0) {
      document.body.style.overflow = state.previous;
      locks.delete(document);
    }
  };
}
