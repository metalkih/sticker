import React from "react";
import type { Issue, Bootstrap } from "../../../server/types.js";
import type { RelationSummary as Summary } from "../../../server/contracts/relations.js";
import { RelationSummary } from "../relations/RelationSummary.js";
import { priorityIcons, priorityNames } from "../../format.js";
export function IssueCard({
  issue: i,
  data,
  onOpen,
  relation,
  relationStale,
  onRelationOpen,
}: {
  issue: Issue;
  data: Bootstrap;
  onOpen: () => void;
  relation?: Summary;
  relationStale: boolean;
  onRelationOpen: (id: string) => void;
}) {
  const p = data.projects.find((p) => p.id === i.projectId);
  const version = data.versions.find((v) => v.id === i.targetVersionId);
  return (
    <article className="issue-card-shell">
      <button className={`issue-card card-${i.status}`} onClick={onOpen}>
        <div className="issue-card-top">
          <span className="issue-key">{i.key}</span>
          <span
            className={`priority-icon priority-${i.priority}`}
            title={priorityNames[i.priority]}
          >
            {priorityIcons[i.priority]}
          </span>
        </div>
        <h4>{i.title}</h4>
        {i.labels.length > 0 && (
          <div className="card-labels">
            {i.labels.slice(0, 3).map((l) => (
              <span className="label-tag" key={l}>
                {l}
              </span>
            ))}
            {i.labels.length > 3 && (
              <span className="label-tag">+{i.labels.length - 3}</span>
            )}
          </div>
        )}
        <div className="issue-card-bottom">
          <span className="card-project">
            <i className="project-dot" style={{ background: p?.color }} />
            {version?.name || p?.name}
          </span>
          <span className="card-assignee" title={i.assignee || "미지정"}>
            {i.assignee ? (
              <span className="avatar tiny">{i.assignee.slice(0, 1)}</span>
            ) : (
              <span className="unassigned-avatar">○</span>
            )}
          </span>
        </div>
      </button>
      <RelationSummary
        summary={relation}
        stale={relationStale}
        onOpen={onRelationOpen}
      />
    </article>
  );
}
