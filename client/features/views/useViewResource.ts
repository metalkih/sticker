import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { api, ApiError, errorText } from "../../api.js";
/** Path-bound authenticated snapshots; superseded successes and errors are ignored. */
export function useViewResource<T>(
  path: string,
  schema: z.ZodType<T>,
  enabled = true,
  refreshToken?: unknown,
) {
  const [snapshot, setSnapshot] = useState<{ path: string; value: T } | null>(
      null,
    ),
    [failure, setFailure] = useState<{ path: string; message: string } | null>(
      null,
    ),
    [pending, setPending] = useState<string | null>(path);
  const sequence = useRef(0);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) return;
      const ticket = ++sequence.current;
      await Promise.resolve();
      if (signal?.aborted) return;
      setPending(path);
      try {
        const value = await api(path, { signal }, schema);
        if (signal?.aborted || ticket !== sequence.current) return;
        setSnapshot({ path, value });
        setFailure(null);
      } catch (error) {
        if (signal?.aborted || ticket !== sequence.current) return;
        setFailure({ path, message: errorText(error) });
        if (error instanceof ApiError && [401, 403, 404].includes(error.status))
          setSnapshot(null);
      } finally {
        if (!signal?.aborted && ticket === sequence.current) setPending(null);
      }
    },
    [path, schema, enabled],
  );
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      void refresh(controller.signal);
    });
    return () => {
      controller.abort();
      sequence.current += 1;
    };
  }, [refresh, refreshToken]);
  const accept = useCallback((value: T, acceptedPath: string) => {
    sequence.current += 1;
    setSnapshot({ path: acceptedPath, value });
    setFailure(null);
    setPending(null);
  }, []);
  return {
    accept,
    value: enabled && snapshot?.path === path ? snapshot.value : null,
    error: enabled && failure?.path === path ? failure.message : "",
    loading: enabled && pending === path,
    refresh,
  };
}
