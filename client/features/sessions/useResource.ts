import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { api, ApiError, errorText } from "../../api.js";
/** Keep successful, path-specific snapshots on transient errors; ignore superseded requests. */
export function useResource<T>(path: string, schema: z.ZodType<T>) {
  const [snapshot, setSnapshot] = useState<{
    path: string;
    value: T;
    stamp: string;
  } | null>(null);
  const [failure, setFailure] = useState<{
    path: string;
    error: string;
    code: string;
  } | null>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(path);
  const sequence = useRef(0);
  const accept = useCallback(
    (value: T) => {
      sequence.current += 1;
      setSnapshot({ path, value, stamp: new Date().toISOString() });
      setFailure(null);
      setPendingPath(null);
    },
    [path],
  );
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const ticket = ++sequence.current;
      await Promise.resolve();
      if (signal?.aborted) return;
      setPendingPath(path);
      try {
        const value = await api(path, { signal }, schema);
        if (signal?.aborted || ticket !== sequence.current) return;
        setSnapshot({ path, value, stamp: new Date().toISOString() });
        setFailure(null);
      } catch (error) {
        if (signal?.aborted || ticket !== sequence.current) return;
        setFailure({
          path,
          error: errorText(error),
          code: error instanceof ApiError ? error.code : "REQUEST_FAILED",
        });
        if (error instanceof ApiError && [401, 403, 404].includes(error.status))
          setSnapshot(null);
      } finally {
        if (!signal?.aborted && ticket === sequence.current)
          setPendingPath(null);
      }
    },
    [path, schema],
  );
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      void refresh(controller.signal);
    });
    const timer = setInterval(() => void refresh(controller.signal), 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  return {
    data: snapshot?.path === path ? snapshot.value : null,
    lastFetched: snapshot?.path === path ? snapshot.stamp : null,
    error: failure?.path === path ? failure.error : "",
    code: failure?.path === path ? failure.code : "",
    loading: pendingPath === path,
    refresh,
    accept,
  };
}
export function useReportClock() {
  const [time, setTime] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      setTime(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return time;
}
