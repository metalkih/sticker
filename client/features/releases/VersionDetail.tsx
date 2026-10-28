import { useState } from "react";
import type { Bootstrap } from "../../../server/types.js";
import { readinessSchema } from "../../../server/contracts/releases.js";
import { ErrorNotice } from "../../components.js";
import { statusNames, versionStateNames, dateText } from "../../format.js";
import { useResource } from "../sessions/useResource.js";
import { FetchStamp } from "../sessions/shared.js";
import ReleaseReview from "./ReleaseReview.js";
export interface VersionDetailProps {
  id: string;
  data: Bootstrap;
  tab: string;
  bucket: string;
  onTab: (tab: string) => void;
  onBucket: (bucket: string) => void;
  onOpenIssue: (id: string) => void;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
}
export default function VersionDetail({
  id,
  data,
  tab,
  bucket,
  onTab,
  onBucket,
  onOpenIssue,
  onBack,
  onChanged,
}: VersionDetailProps) {
  const resource = useResource(
      `/versions/${encodeURIComponent(id)}/readiness`,
      readinessSchema,
    ),
    [review, setReview] = useState(false),
    ready = resource.data;
  const role = tab === "found" ? "found" : tab === "fixed" ? "fixed" : "target";
  const issues = ready
    ? role === "target"
      ? ready.targetIssues
      : role === "found"
        ? ready.foundIssues
        : ready.fixedIssues
    : [];
  const filtered = issues.filter(
    (issue) =>
      role !== "target" ||
      bucket === "all" ||
      (bucket === "unfinished" &&
        issue.status !== "done" &&
        issue.status !== "closed") ||
      (bucket === "done" && issue.status === "done") ||
      (bucket === "closed" && issue.status === "closed") ||
      (bucket === "blocked" && ready?.blockedIssueIds.includes(issue.id)),
  );
  async function changed() {
    await resource.refresh();
    await onChanged();
  }
  return (
    <section className="version-detail" aria-label="버전 상세">
      <div className="release-toolbar">
        <button className="button secondary" onClick={onBack}>
          버전 목록
        </button>
        <button
          className="button secondary"
          onClick={() => void resource.refresh()}
        >
          버전 상세 새로고침
        </button>
      </div>
      <FetchStamp value={resource.lastFetched} failed={!!resource.error} />
      <ErrorNotice message={resource.error} />
      {resource.loading && !ready && <p role="status">버전 불러오는 중…</p>}
      {ready && (
        <>
          <header className="release-title">
            <div>
              <h2>{ready.version.name}</h2>
              <span>
                {versionStateNames[ready.version.state]} · r
                {ready.version.revision} · {dateText(ready.version.dueDate)}
              </span>
            </div>
            {data.actor.canWrite && (
              <button
                className="button primary"
                onClick={() => {
                  setReview(true);
                }}
              >
                출시 검토
              </button>
            )}
          </header>
          {ready.version.description && <p>{ready.version.description}</p>}
          <div className="release-counts">
            {(
              [
                ["unfinished", "미완료"],
                ["done", "구현 완료"],
                ["closed", "소유자 종결"],
                ["blocked", "차단"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className="button secondary"
                aria-pressed={role === "target" && bucket === value}
                onClick={() => {
                  onTab("target");
                  onBucket(value);
                }}
              >
                {label} {ready.counts[value]}
              </button>
            ))}
            <button
              className="button secondary"
              onClick={() => {
                onTab("target");
                onBucket("all");
              }}
            >
              전체 {ready.counts.total}
            </button>
          </div>
          {!ready.counts.total && (
            <p className="release-empty">목표 이슈 없음</p>
          )}
          <div
            className="release-tabs"
            role="tablist"
            aria-label="버전 연결 구분"
          >
            {(
              [
                ["target", "목표", ready.targetIssues.length],
                ["found", "발견", ready.foundIssues.length],
                ["fixed", "수정", ready.fixedIssues.length],
              ] as const
            ).map(([value, label, count], index) => (
              <button
                key={value}
                role="tab"
                tabIndex={role === value ? 0 : -1}
                aria-selected={role === value}
                onClick={() => {
                  onTab(value);
                  onBucket("all");
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                    return;
                  event.preventDefault();
                  const next =
                    (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                  onTab(["target", "found", "fixed"][next]);
                  onBucket("all");
                  const buttons =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]',
                    );
                  buttons?.item(next).focus();
                }}
              >
                {label} {count}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            aria-label={`${role === "target" ? "목표" : role === "found" ? "발견" : "수정"} 이슈`}
            className="release-issues"
          >
            {filtered.length ? (
              filtered.map((issue) => (
                <button
                  className="release-issue-row"
                  key={issue.id}
                  onClick={() => {
                    onOpenIssue(issue.id);
                  }}
                >
                  <span>
                    {issue.key} · {issue.title}
                  </span>
                  <span>
                    {statusNames[issue.status]}
                    {ready.blockedIssueIds.includes(issue.id) ? " · 차단" : ""}
                  </span>
                </button>
              ))
            ) : (
              <p>해당 이슈 없음</p>
            )}
          </div>
          {ready.releaseHistory.length > 0 && (
            <section aria-label="출시 변경 기록">
              <h3>출시 변경 기록</h3>
              {ready.releaseHistory.map((entry) => (
                <p key={entry.id}>
                  {versionStateNames[entry.fromState]} →{" "}
                  {versionStateNames[entry.toState]} · {entry.authorName} ·{" "}
                  {dateText(entry.createdAt, true)}
                </p>
              ))}
            </section>
          )}
          {review && (
            <ReleaseReview
              readiness={ready}
              lastFetched={resource.lastFetched}
              refreshError={resource.error}
              data={data}
              onClose={() => {
                setReview(false);
              }}
              onChanged={changed}
            />
          )}
        </>
      )}
    </section>
  );
}
