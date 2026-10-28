import { useState } from "react";
import type { Issue } from "../../../server/types.js";
import {
  changelogSchema,
  type Changelog,
} from "../../../server/contracts/releases.js";
import { api, json, errorText } from "../../api.js";
import { Field, ErrorNotice } from "../../components.js";
import { useResource } from "../sessions/useResource.js";
import { FetchStamp } from "../sessions/shared.js";
function DraftForm({
  initial,
  issues,
  onDirty,
  onPending,
  onRefresh,
  onAccepted,
}: {
  initial: Changelog;
  issues: Issue[];
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
  onRefresh: () => Promise<void>;
  onAccepted: (next: Changelog) => void;
}) {
  const [markdown, setMarkdown] = useState(initial.markdown),
    [selected, setSelected] = useState(initial.selectedIssueIds),
    [saved, setSaved] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty =
    markdown !== saved.markdown ||
    JSON.stringify(selected) !== JSON.stringify(saved.selectedIssueIds);
  function accept(next: Changelog) {
    setMarkdown(next.markdown);
    setSelected(next.selectedIssueIds);
    setSaved(next);
    onDirty(false);
    setError("");
  }
  async function save(generate = false) {
    if (busy) return;
    if (
      generate &&
      dirty &&
      !window.confirm("저장하지 않은 변경로그 초안을 바꿀까요?")
    )
      return;
    setBusy(true);
    onPending(true);
    setError("");
    try {
      const next = await api(
        `/versions/${encodeURIComponent(initial.versionId)}/changelog${generate ? "/generate" : ""}`,
        {
          method: generate ? "POST" : "PUT",
          body: json({
            revision: saved.revision,
            selectedIssueIds: selected,
            ...(generate ? {} : { markdown }),
          }),
        },
        changelogSchema,
      );
      accept(next);
      onAccepted(next);
      await onRefresh();
    } catch (e) {
      setError(errorText(e));
      await onRefresh();
    } finally {
      setBusy(false);
      onPending(false);
    }
  }
  return (
    <div className="release-draft">
      <fieldset disabled={busy}>
        <legend>변경로그에 포함할 이슈</legend>
        {issues.length ? (
          issues.map((issue) => (
            <label className="release-check" key={issue.id}>
              <input
                type="checkbox"
                checked={selected.includes(issue.id)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, issue.id]
                    : selected.filter((id) => id !== issue.id);
                  setSelected(next);
                  onDirty(
                    markdown !== saved.markdown ||
                      JSON.stringify(next) !==
                        JSON.stringify(saved.selectedIssueIds),
                  );
                }}
              />
              {issue.key} · {issue.title}
            </label>
          ))
        ) : (
          <p>포함할 이슈 없음</p>
        )}
        {selected
          .filter((id) => !issues.some((issue) => issue.id === id))
          .map((id) => (
            <label className="release-check" key={id}>
              <input
                type="checkbox"
                checked
                aria-label={`현재 범위 밖 이슈 ${id}`}
                onChange={() => {
                  const next = selected.filter((value) => value !== id);
                  setSelected(next);
                  onDirty(
                    markdown !== saved.markdown ||
                      JSON.stringify(next) !==
                        JSON.stringify(saved.selectedIssueIds),
                  );
                }}
              />
              현재 범위 밖 · {id}
            </label>
          ))}
      </fieldset>
      <button
        className="button secondary"
        disabled={busy || !selected.length}
        onClick={() => void save(true)}
      >
        선택 이슈로 초안 생성
      </button>
      <Field label="Markdown 변경로그">
        <textarea
          value={markdown}
          rows={10}
          maxLength={100000}
          disabled={busy}
          onChange={(event) => {
            setMarkdown(event.target.value);
            onDirty(
              event.target.value !== saved.markdown ||
                JSON.stringify(selected) !==
                  JSON.stringify(saved.selectedIssueIds),
            );
          }}
        />
      </Field>
      <p role="status">
        {dirty
          ? "저장하지 않은 변경"
          : `저장된 초안 r${String(saved.revision)}`}
      </p>
      <ErrorNotice message={error} />
      {initial.revision > saved.revision && (
        <div className="release-conflict">
          <span>서버 초안 r{initial.revision}</span>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "작성 중인 초안을 서버의 최신 초안으로 바꿀까요?",
                )
              )
                accept(initial);
            }}
          >
            최신 초안 불러오기
          </button>
        </div>
      )}
      <div className="release-toolbar">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "초안 저장 중…" : "초안 저장"}
        </button>
        <a
          className="button secondary"
          href={`/api/versions/${encodeURIComponent(initial.versionId)}/changelog/export`}
          download="changelog.md"
        >
          저장된 Markdown 내보내기
        </a>
      </div>
    </div>
  );
}
export default function ChangelogEditor({
  versionId,
  issues,
  onDirty,
  onPending,
}: {
  versionId: string;
  issues: Issue[];
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
}) {
  const resource = useResource(
    `/versions/${encodeURIComponent(versionId)}/changelog`,
    changelogSchema,
  );
  return (
    <section aria-label="변경로그 초안">
      <h3>변경로그 초안</h3>
      <FetchStamp value={resource.lastFetched} failed={!!resource.error} />
      <ErrorNotice message={resource.error} />
      {resource.loading && !resource.data && (
        <p role="status">초안 불러오는 중…</p>
      )}
      {resource.error && (
        <button
          className="button secondary"
          onClick={() => void resource.refresh()}
        >
          초안 조회 다시 시도
        </button>
      )}
      {resource.data && (
        <DraftForm
          key={versionId}
          initial={resource.data}
          issues={issues}
          onDirty={onDirty}
          onPending={onPending}
          onRefresh={resource.refresh}
          onAccepted={resource.accept}
        />
      )}
    </section>
  );
}
