import React, { useEffect, useRef, useState } from "react";
import {
  resourceDetailSchema,
  resourceVersionSchema,
  type ResourceDetail,
  type Resource,
} from "../../../server/contracts/resources.js";
import type { Bootstrap } from "../../../server/types.js";
import { api, json, errorText } from "../../api.js";
import { ErrorNotice, Field, Modal } from "../../components.js";
import { dateText } from "../../format.js";
import { navigate } from "../../router.js";
import { useViewResource } from "../views/useViewResource.js";
import { ResourceContent } from "./ResourceContent.js";
import { ResourceEditor } from "./ResourceEditor.js";
export function ResourceDetailView({
  id,
  projectId,
  data,
  initial,
  initialVersion = 0,
  onBack,
}: {
  id: string;
  projectId?: string;
  data: Bootstrap;
  initial?: ResourceDetail;
  initialVersion?: number;
  onBack: () => void;
}) {
  const path = `/resources/${id}`,
    resource = useViewResource(path, resourceDetailSchema),
    seed = useRef(initial);
  const accept = resource.accept;
  useEffect(() => {
    if (seed.current) {
      accept(seed.current, path);
      seed.current = undefined;
    }
  }, [path, accept]);
  const [routeVersion, setRouteVersion] = useState(initialVersion),
    [selected, setSelected] = useState(initialVersion),
    [editing, setEditing] = useState<ResourceDetail | null>(null),
    [action, setAction] = useState<{
      kind: "delete" | "guidance";
      target: Resource;
    } | null>(null);
  if (routeVersion !== initialVersion) {
    setRouteVersion(initialVersion);
    setSelected(initialVersion);
    setEditing(null);
    setAction(null);
  }
  const detail = resource.value;
  const historical = useViewResource(
    `/resources/${id}/versions/${String(selected)}`,
    resourceVersionSchema,
    selected > 0 && selected !== detail?.current?.version,
  );
  const content =
    selected > 0 && selected !== detail?.current?.version
      ? historical.value
      : detail?.current;
  const writable =
    !!detail &&
    data.actor.canWrite &&
    !detail.resource.deletedAt &&
    (!detail.resource.isGuidance || data.actor.role === "owner");
  const version = data.versions.find(
    (v) => v.id === detail?.resource.versionId,
  );
  const eventNames = {
    created: "등록",
    updated: "수정",
    guidance_designated: "지침 지정",
    guidance_removed: "지침 해제",
    deleted: "삭제",
  };
  if (detail && projectId && detail.resource.projectId !== projectId)
    return (
      <section aria-label="자료 상세">
        <ErrorNotice message="프로젝트 범위가 일치하지 않습니다." />
        <button type="button" onClick={onBack}>
          자료실로
        </button>
      </section>
    );
  return (
    <section className="resource-detail" aria-label="자료 상세">
      <header className="resource-toolbar">
        <button type="button" onClick={onBack}>
          자료실로
        </button>
        <button
          type="button"
          disabled={resource.loading}
          onClick={() => {
            void resource.refresh();
          }}
        >
          자료 새로고침
        </button>
      </header>
      <ErrorNotice message={resource.error} />
      {resource.error && detail && <span role="status">이전 조회 정보</span>}
      {resource.loading && !detail && <p role="status">자료 불러오는 중…</p>}
      {detail && (
        <>
          <header>
            <h2>{detail.resource.title}</h2>
            <div className="resource-badges">
              {detail.resource.deletedAt && <span>삭제된 자료</span>}
              <span>
                {detail.resource.isGuidance ? "소유자 지정 지침" : "일반 자료"}
              </span>
              <span>
                {detail.resource.versionId
                  ? detail.resource.versionAvailable
                    ? (version?.name ?? "버전 이름 미확인")
                    : "사용할 수 없는 버전"
                  : "프로젝트 공통"}
              </span>
              <span>수정 버전 {detail.resource.revision}</span>
            </div>
          </header>
          <dl className="resource-metadata">
            <div>
              <dt>등록</dt>
              <dd>{dateText(detail.resource.createdAt, true)}</dd>
            </div>
            <div>
              <dt>수정</dt>
              <dd>{dateText(detail.resource.updatedAt, true)}</dd>
            </div>
            {detail.resource.isGuidance && (
              <div>
                <dt>지침 지정</dt>
                <dd>
                  {detail.resource.guidanceBy} ·{" "}
                  {detail.resource.guidanceAt &&
                    dateText(detail.resource.guidanceAt, true)}
                </dd>
              </div>
            )}
          </dl>
          <div className="resource-toolbar">
            {writable && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(detail);
                  }}
                >
                  자료 편집
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAction({ kind: "delete", target: detail.resource });
                  }}
                >
                  자료 삭제
                </button>
              </>
            )}
            {data.actor.role === "owner" && !detail.resource.deletedAt && (
              <button
                type="button"
                onClick={() => {
                  setAction({ kind: "guidance", target: detail.resource });
                }}
              >
                {detail.resource.isGuidance ? "지침 해제" : "지침 지정"}
              </button>
            )}
          </div>
          <Field label="내용 이력">
            <select
              value={selected || detail.current?.version || 0}
              onChange={(e) => {
                setSelected(Number(e.target.value));
              }}
            >
              {!detail.current && !selected && (
                <option value={0}>이력 선택</option>
              )}
              {detail.history.map((v) => (
                <option
                  key={v.version}
                  value={v.version}
                >{`v${String(v.version)} · ${v.authorName} · ${dateText(v.createdAt, true)}`}</option>
              ))}
            </select>
          </Field>
          <ErrorNotice message={historical.error} />
          {historical.loading && selected > 0 && (
            <div role="status">내용 불러오는 중…</div>
          )}
          {content && (
            <section aria-label="자료 내용">
              <div className="resource-content-stamp">
                내용 버전 {content.version} · {content.authorName} ·{" "}
                {dateText(content.createdAt, true)}
              </div>
              <ResourceContent
                key={`${content.resourceId}:${String(content.version)}`}
                version={content}
              />
            </section>
          )}
          <section aria-label="연결된 이슈">
            <h3>
              연결된 이슈 <span>{detail.usage.issues.length}</span>
            </h3>
            {detail.usage.issues.map((item) => (
              <button
                key={`${item.issueId}:${String(item.resourceVersion)}`}
                className="resource-reference"
                onClick={() => {
                  navigate({
                    section: "issues",
                    project: detail.resource.projectId,
                    issue: item.issueId,
                  });
                }}
              >
                {item.key} · {item.title} · v{item.resourceVersion}
              </button>
            ))}
          </section>
          <section aria-label="에이전트 참조 기록">
            <h3>
              에이전트 참조 기록 <span>{detail.usage.results.length}</span>
            </h3>
            {detail.usage.results.map((item) => (
              <button
                key={`${item.sessionId}:${item.eventId}:${String(item.resourceVersion)}`}
                className="resource-reference"
                onClick={() => {
                  navigate({
                    section: "agents",
                    project: detail.resource.projectId,
                    session: item.sessionId,
                    issue: "",
                  });
                }}
              >
                {item.agentName} · v{item.resourceVersion} · 결과 {item.eventId}
              </button>
            ))}
          </section>
          <section aria-label="자료 변경 이력">
            <h3>변경 이력</h3>
            <ol className="resource-history">
              {detail.events.map((event) => (
                <li key={event.id}>
                  {eventNames[event.action]} · {event.authorName} ·{" "}
                  {dateText(event.createdAt, true)} · 수정 버전 {event.revision}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
      {editing && (
        <ResourceEditor
          data={data}
          projectId={editing.resource.projectId}
          initial={editing}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={(next) => {
            resource.accept(next, path);
            setEditing(null);
            setSelected(0);
          }}
        />
      )}
      {action && (
        <ResourceAction
          key={`${action.kind}:${String(action.target.revision)}`}
          action={action}
          onClose={() => {
            setAction(null);
          }}
          onSaved={(next) => {
            resource.accept(next, path);
            setAction(null);
          }}
        />
      )}
    </section>
  );
}
function ResourceAction({
  action,
  onClose,
  onSaved,
}: {
  action: { kind: "delete" | "guidance"; target: Resource };
  onClose: () => void;
  onSaved: (next: ResourceDetail) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const operationId = useRef(crypto.randomUUID());
  const label =
    action.kind === "delete"
      ? "자료 삭제"
      : action.target.isGuidance
        ? "소유자 지침 해제"
        : "소유자 지침 지정";
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api(
        `/resources/${action.target.id}${action.kind === "guidance" ? "/guidance" : ""}`,
        {
          method: action.kind === "delete" ? "DELETE" : "PATCH",
          body: json({
            revision: action.target.revision,
            operationId: operationId.current,
            ...(action.kind === "guidance"
              ? { isGuidance: !action.target.isGuidance }
              : {}),
          }),
        },
        resourceDetailSchema,
      );
      onSaved(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={label}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="editor-form">
        <strong>{action.target.title}</strong>
        <p className="confirm-description">
          {action.kind === "delete"
            ? "자료실에서 제거합니다. 연결된 이슈와 이전 버전의 기록은 유지됩니다."
            : action.target.isGuidance
              ? "소유자 지침 지정을 해제합니다."
              : "이 자료를 소유자 지침으로 지정합니다."}
        </p>
        <span>
          현재 내용 버전 {action.target.currentVersion} · 수정 버전{" "}
          {action.target.revision}
        </span>
        <ErrorNotice message={error} />
        <footer className="form-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void submit();
            }}
          >
            {busy
              ? "처리 중…"
              : action.kind === "delete"
                ? "삭제하기"
                : action.target.isGuidance
                  ? "해제하기"
                  : "지정하기"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
