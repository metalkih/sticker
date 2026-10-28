import React, { useEffect, useRef, useState } from "react";
import type { Bootstrap, Status } from "../../../server/types.js";
import { STATUSES } from "../../../server/types.js";
import type { IssueQuery } from "../../../server/contracts/issue-query.js";
import {
  issueQueryResultSchema,
  savedViewSchema,
  viewPreferencesSchema,
  type SavedView,
} from "../../../server/contracts/views.js";
import type { RelationSummary } from "../../../server/contracts/relations.js";
import { useViewResource } from "./useViewResource.js";
import { IssueFilters } from "./IssueFilters.js";
import { SavedViewEditor } from "./SavedViewEditor.js";
import { IssueCard } from "../issues/IssueCard.js";
import { IssueListRow } from "../issues/IssueListRow.js";
import { Empty, Icon } from "../../components.js";
import { Confirm } from "../../editors.js";
import { api, json } from "../../api.js";
import { statusIcons, statusNames } from "../../format.js";
const baseQuery = (projectId: string): IssueQuery => ({
  projectId: projectId || undefined,
  sort: "updated_desc",
  mode: "board",
});
export function SavedIssueWorkspace({
  data,
  projectId,
  viewId,
  onSelect,
  onChanged,
  onNew,
  relations,
  relationStale,
  onOpen,
}: {
  data: Bootstrap;
  projectId: string;
  viewId: string;
  onSelect: (id: string, projectId?: string) => void;
  onChanged: () => void;
  onNew: (status: Status) => void;
  relations: Record<string, RelationSummary>;
  relationStale: boolean;
  onOpen: (id: string) => void;
}) {
  const selected = useViewResource(
    `/views/${viewId}`,
    savedViewSchema,
    !!viewId,
    data,
  );
  const prefs = useViewResource(
    `/view-preferences/${projectId}`,
    viewPreferencesSchema,
    !!projectId,
  );
  const key = `${projectId}:${viewId}`;
  const [state, setState] = useState<{
    key: string;
    record: SavedView | null;
    query: IssueQuery;
    loaded: boolean;
  }>({ key, record: null, query: baseQuery(projectId), loaded: !viewId });
  const [editor, setEditor] = useState<"save" | "copy" | null>(null),
    [removing, setRemoving] = useState(false);
  if (state.key !== key) {
    setState({
      key,
      record: null,
      query: baseQuery(projectId),
      loaded: !viewId,
    });
    setEditor(null);
    setRemoving(false);
  }
  if (
    state.key === key &&
    !state.loaded &&
    selected.value &&
    selected.value.projectId === projectId
  )
    setState({
      key,
      record: selected.value,
      query: selected.value.query,
      loaded: true,
    });
  useEffect(() => {
    if (selected.value && selected.value.projectId !== projectId)
      onSelect(selected.value.id, selected.value.projectId);
  }, [selected.value, projectId, onSelect]);
  const entered = useRef<string | null>(null);
  useEffect(() => {
    if (entered.current === projectId) return;
    if (viewId) {
      entered.current = projectId;
      return;
    }
    if (prefs.value) {
      entered.current = projectId;
      if (prefs.value.defaultViewId) onSelect(prefs.value.defaultViewId);
    }
  }, [projectId, viewId, prefs.value, onSelect]);
  const ready =
    state.key === key && state.loaded && (!viewId || !!selected.value);
  const result = useViewResource(
    `/issues?filter=${encodeURIComponent(JSON.stringify(state.query))}`,
    issueQueryResultSchema,
    ready,
    data,
  );
  const dirty =
    JSON.stringify(state.query) !==
    JSON.stringify(state.record?.query ?? baseQuery(projectId));
  const issues = result.value?.issues ?? [];
  const setQuery = (query: IssueQuery) => {
    setState({ ...state, query });
  };
  const versions = data.versions.filter((v) => v.projectId === projectId);
  const exampleVersion =
    versions.find((v) => v.id === state.query.targetVersionId) ??
    versions.at(0);
  return (
    <div className="issues-section">
      <div className="issues-toolbar">
        <div className="section-title">
          <h2>{state.record?.name ?? "붙여 둔 이슈"}</h2>
          <span>{issues.length}</span>
          {dirty && <span role="status">저장되지 않음</span>}
        </div>
        <div className="view-switch" aria-label="보기 방식">
          {(["board", "list"] as const).map((mode) => (
            <button
              key={mode}
              aria-pressed={state.query.mode === mode}
              className={state.query.mode === mode ? "active" : ""}
              onClick={() => {
                setQuery({ ...state.query, mode });
              }}
            >
              <Icon name={mode === "board" ? "board" : "list"} size={15} />
              {mode === "board" ? "보드" : "리스트"}
            </button>
          ))}
        </div>
      </div>
      <div className="saved-view-actions">
        <button
          disabled={!projectId || !ready}
          onClick={() => {
            setEditor("save");
          }}
        >
          {state.record ? "뷰 저장" : "새 뷰 저장"}
        </button>
        {state.record && (
          <>
            <button
              onClick={() => {
                setEditor("save");
              }}
            >
              이름 변경
            </button>
            <button
              onClick={() => {
                setEditor("copy");
              }}
            >
              뷰 복제
            </button>
            <button
              onClick={() => {
                setRemoving(true);
              }}
            >
              뷰 삭제
            </button>
            <button
              onClick={() => {
                onSelect("");
              }}
            >
              일반 보드
            </button>
          </>
        )}
        {projectId && (
          <select
            aria-label="예시 뷰"
            value=""
            onChange={(e) => {
              if (e.target.value === "review")
                setQuery({ ...baseQuery(projectId), status: ["done"] });
              if (e.target.value === "input")
                setQuery({ ...baseQuery(projectId), inputRequested: true });
              if (e.target.value === "version" && exampleVersion)
                setQuery({
                  ...baseQuery(projectId),
                  targetVersionId: exampleVersion.id,
                  status: [
                    "backlog",
                    "ready",
                    "in_progress",
                    "waiting",
                    "done",
                  ],
                });
            }}
          >
            <option value="">예시</option>
            <option value="review">소유자 검토 대기 · 예시</option>
            <option value="input">에이전트 입력 요청 · 예시</option>
            <option value="version" disabled={!exampleVersion}>
              {exampleVersion?.name ?? "버전 없음"} 미종결 · 예시
            </option>
          </select>
        )}
      </div>
      {selected.error && (
        <div role="alert">
          {selected.error}
          <button
            onClick={() => {
              void selected.refresh();
            }}
          >
            다시 불러오기
          </button>
          <button
            onClick={() => {
              onSelect("");
            }}
          >
            일반 보드
          </button>
        </div>
      )}
      {selected.value &&
        state.record &&
        selected.value.revision > state.record.revision && (
          <div role="status">
            새 버전 있음
            <button
              onClick={() => {
                const record = selected.value;
                if (record)
                  setState({ key, record, query: record.query, loaded: true });
              }}
            >
              저장한 내용 다시 불러오기
            </button>
          </div>
        )}
      {ready && (
        <IssueFilters data={data} query={state.query} onChange={setQuery} />
      )}
      {result.error && (
        <div role="alert">
          {result.value ? "이전 결과 · 최신 확인 실패: " : ""}
          {result.error}
          <button
            onClick={() => {
              void result.refresh();
            }}
          >
            결과 재시도
          </button>
        </div>
      )}
      {result.value?.warnings.map((w) => (
        <div role="alert" key={w.field}>
          {w.message}
        </div>
      ))}
      {((!ready && !selected.error) || (result.loading && !result.value)) && (
        <div role="status">불러오는 중</div>
      )}
      {ready && result.value && !issues.length && (
        <Empty
          title={
            !data.projects.length
              ? "프로젝트 없음"
              : data.issues.some((i) => !projectId || i.projectId === projectId)
                ? "검색 결과 없음"
                : "이슈 없음"
          }
          action={
            <button
              className="button primary"
              onClick={() => {
                onNew("backlog");
              }}
            >
              새 이슈
            </button>
          }
        />
      )}
      {ready &&
        issues.length > 0 &&
        (state.query.mode === "board" ? (
          <div className="board">
            {STATUSES.filter(
              (s) => !state.query.status || state.query.status.includes(s),
            ).map((s) => (
              <section className={`board-column column-${s}`} key={s}>
                <header>
                  <div>
                    <span className={`column-icon status-${s}`}>
                      {statusIcons[s]}
                    </span>
                    <h3>{statusNames[s]}</h3>
                    <span className="count">
                      {issues.filter((i) => i.status === s).length}
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`${statusNames[s]} 이슈 추가`}
                    onClick={() => {
                      onNew(s);
                    }}
                  >
                    <Icon name="plus" size={15} />
                  </button>
                </header>
                <div className="column-body">
                  {issues
                    .filter((i) => i.status === s)
                    .map((i) => (
                      <IssueCard
                        key={i.id}
                        issue={i}
                        data={data}
                        relation={relations[i.id]}
                        relationStale={relationStale}
                        onOpen={() => {
                          onOpen(i.id);
                        }}
                        onRelationOpen={onOpen}
                      />
                    ))}
                  {!issues.some((i) => i.status === s) && (
                    <div className="column-empty">이슈 없음</div>
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="issue-list">
            <div className="list-table-head">
              <span>이슈</span>
              <span>상태</span>
              <span>담당자</span>
              <span>목표 버전</span>
            </div>
            {issues.map((i) => (
              <IssueListRow
                key={i.id}
                issue={i}
                data={data}
                relation={relations[i.id]}
                relationStale={relationStale}
                onOpen={() => {
                  onOpen(i.id);
                }}
                onRelationOpen={onOpen}
              />
            ))}
          </div>
        ))}
      {editor && (
        <SavedViewEditor
          view={state.record}
          query={state.query}
          duplicate={editor === "copy"}
          onClose={() => {
            setEditor(null);
          }}
          onSaved={(record) => {
            selected.accept(record, `/views/${record.id}`);
            setEditor(null);
            setState({
              key: `${record.projectId}:${record.id}`,
              record,
              query: record.query,
              loaded: true,
            });
            onChanged();
            onSelect(record.id, record.projectId);
            return Promise.resolve();
          }}
        />
      )}
      {removing && state.record && (
        <Confirm
          title={`${state.record.name} 삭제`}
          description="저장한 뷰와 즐겨찾기만 삭제됩니다. 이슈는 유지됩니다."
          onClose={() => {
            setRemoving(false);
          }}
          onConfirm={async () => {
            if (!state.record) return;
            await api(`/views/${state.record.id}`, {
              method: "DELETE",
              body: json({ revision: state.record.revision }),
            });
            setRemoving(false);
            onChanged();
            onSelect("");
          }}
        />
      )}
    </div>
  );
}
