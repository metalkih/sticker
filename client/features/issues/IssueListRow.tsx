import React from "react";
import type { Issue, Bootstrap } from "../../../server/types.js";
import type { RelationSummary as Summary } from "../../../server/contracts/relations.js";
import { RelationSummary } from "../relations/RelationSummary.js";
import { StatusPill } from "../../components.js";
import { priorityIcons, priorityNames } from "../../format.js";
export function IssueListRow({
  issue: i,
  data,
  relation,
  relationStale,
  onOpen,
  onRelationOpen,
}: {
  issue: Issue;
  data: Bootstrap;
  relation?: Summary;
  relationStale: boolean;
  onOpen: () => void;
  onRelationOpen: (id: string) => void;
}) {
  return (
    <div className="issue-list-item">
      <button className="issue-list-row" onClick={onOpen}>
        <span className="list-issue-title">
          <span
            className={`priority-icon priority-${i.priority}`}
            title={priorityNames[i.priority]}
          >
            {priorityIcons[i.priority]}
          </span>
          <span className="issue-key">{i.key}</span>
          <strong>{i.title}</strong>
        </span>
        <StatusPill status={i.status} />
        <span className="list-assignee">{i.assignee || "미지정"}</span>
        <span className="list-version">
          {data.versions.find((v) => v.id === i.targetVersionId)?.name || "—"}
        </span>
      </button>
      <RelationSummary
        summary={relation}
        stale={relationStale}
        onOpen={onRelationOpen}
      />
    </div>
  );
}
