import { useEffect, useRef } from "react";
import { registerRouteGuard } from "../../router.js";
export function useDraftGuard(dirty: boolean, busy: boolean) {
  const bypass = useRef(false);
  useEffect(
    () =>
      registerRouteGuard(
        () =>
          bypass.current ||
          (!busy &&
            (!dirty ||
              window.confirm("저장하지 않은 초안을 버리고 이동할까요?"))),
      ),
    [dirty, busy],
  );
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("beforeunload", before);
    };
  }, [dirty]);
  function proceed(action: () => void) {
    bypass.current = true;
    try {
      action();
    } finally {
      bypass.current = false;
    }
  }
  function leave(action: () => void) {
    if (busy) return;
    if (dirty && !window.confirm("저장하지 않은 초안을 버릴까요?")) return;
    proceed(action);
  }
  return { proceed, leave };
}
