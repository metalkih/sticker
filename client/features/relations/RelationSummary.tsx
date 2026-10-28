import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  relationSummariesSchema,
  type RelationSummary as Summary,
} from "../../../server/contracts/relations.js";
import { api, errorText } from "../../api.js";
import type { Bootstrap } from "../../../server/types.js";
/** One authorized batched read per workspace refresh, never one request per card. */
export function useRelationSummaries(data: Bootstrap | null) {
  const [summaries, setSummaries] = useState<Record<string, Summary>>({}),
    [error, setError] = useState(""),
    [pending, setPending] = useState(true);
  const sequence = useRef(0);
  const reload = useCallback(() => {
    const ticket = ++sequence.current;
    return api("/relations/summary", undefined, relationSummariesSchema).then(
      (next) => {
        if (ticket !== sequence.current) return;
        setSummaries(next);
        setError("");
        setPending(false);
      },
      (e: unknown) => {
        if (ticket !== sequence.current) return;
        setError(errorText(e));
        setPending(false);
      },
    );
  }, []);
  useEffect(() => {
    if (data) void reload();
    return () => {
      sequence.current += 1;
    };
  }, [data, reload]);
  return { summaries, error, pending, reload };
}
export function RelationSummary({
  summary,
  onOpen,
  stale = false,
}: {
  summary: Summary | undefined;
  onOpen: (id: string) => void;
  stale?: boolean;
}) {
  if (!summary) return null;
  const total = Object.values(summary.childCounts).reduce((a, b) => a + b, 0);
  if (!total && !summary.blockers.length) return null;
  return (
    <div className="relation-summary" aria-label="관계 요약">
      {stale && (
        <span className="relation-stale">이전 정보 · 최신 확인 실패</span>
      )}
      {summary.blockers.map((i) => (
        <button
          type="button"
          key={i.id}
          className="relation-blocker"
          onClick={() => {
            onOpen(i.id);
          }}
          aria-label={`차단 원인 ${i.key}: ${i.title}`}
        >
          차단됨 · {i.key}
        </button>
      ))}
      {total > 0 && (
        <span className="relation-child-count">
          하위 {total} · 구현 완료 {summary.childCounts.done} · 소유자 종결{" "}
          {summary.childCounts.closed}
        </span>
      )}
    </div>
  );
}
