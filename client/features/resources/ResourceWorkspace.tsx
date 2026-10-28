import React, { useState } from "react";
import {
  resourceSchema,
  type ResourceDetail,
} from "../../../server/contracts/resources.js";
import type { Bootstrap } from "../../../server/types.js";
import { Field, ErrorNotice } from "../../components.js";
import { dateText } from "../../format.js";
import { useViewResource } from "../views/useViewResource.js";
import { ResourceEditor } from "./ResourceEditor.js";
import { ResourceDetailView } from "./ResourceDetail.js";
const listSchema = resourceSchema.array();
const kindNames = { markdown: "문서", link: "링크", file: "파일" };
export function ResourceWorkspace({
  projectId,
  resourceId,
  scopeVersion,
  data,
  onSelect,
  onScope,
  contentVersion = "",
}: {
  projectId: string;
  resourceId: string;
  scopeVersion: string;
  contentVersion?: string;
  data: Bootstrap;
  onSelect: (id: string) => void;
  onScope: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState(""),
    [creating, setCreating] = useState(false),
    [confirmed, setConfirmed] = useState<ResourceDetail | null>(null);
  const project = data.projects.find((p) => p.id === projectId),
    versions = data.versions.filter((v) => v.projectId === projectId);
  const params = new URLSearchParams({ projectId });
  if (query.trim()) params.set("query", query.trim());
  if (kind) params.set("kind", kind);
  if (scopeVersion && scopeVersion !== "common")
    params.set("versionId", scopeVersion);
  const resource = useViewResource(
    `/resources?${params.toString()}`,
    listSchema,
    !!project && !resourceId,
  );
  const items = resource.value?.filter(
    (item) => scopeVersion !== "common" || item.versionId === null,
  );
  if (!project)
    return (
      <div role="status">
        {projectId ? "프로젝트를 확인할 수 없습니다." : "프로젝트 선택"}
      </div>
    );
  return (
    <section className="resource-workspace" aria-label="프로젝트 자료실">
      {resourceId ? (
        <ResourceDetailView
          key={resourceId}
          id={resourceId}
          projectId={projectId}
          data={data}
          initialVersion={
            /^\d+$/.test(contentVersion) ? Number(contentVersion) : 0
          }
          initial={
            confirmed?.resource.id === resourceId ? confirmed : undefined
          }
          onBack={() => {
            onSelect("");
          }}
        />
      ) : (
        <>
          <div className="resource-toolbar">
            <Field label="자료 검색">
              <input
                type="search"
                value={query}
                maxLength={200}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
              />
            </Field>
            <Field label="자료 유형 필터">
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                }}
              >
                <option value="">모든 유형</option>
                <option value="markdown">문서</option>
                <option value="link">링크</option>
                <option value="file">파일</option>
              </select>
            </Field>
            <Field label="자료 범위 필터">
              <select
                value={scopeVersion}
                onChange={(e) => {
                  onScope(e.target.value);
                }}
              >
                <option value="">프로젝트의 모든 자료</option>
                <option value="common">프로젝트 공통</option>
                {scopeVersion &&
                  scopeVersion !== "common" &&
                  !versions.some((v) => v.id === scopeVersion) && (
                    <option value={scopeVersion}>사용할 수 없는 버전</option>
                  )}
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              disabled={resource.loading}
              onClick={() => {
                void resource.refresh();
              }}
            >
              목록 새로고침
            </button>
            {data.actor.canWrite && (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                }}
              >
                자료 등록
              </button>
            )}
          </div>
          <ErrorNotice message={resource.error} />
          {resource.error && items && <div role="status">이전 조회 목록</div>}
          {resource.loading && !items && (
            <div role="status">자료 불러오는 중…</div>
          )}
          {items?.length === 0 && <p>자료 없음</p>}
          <div className="resource-grid">
            {items?.map((item) => (
              <button
                key={item.id}
                type="button"
                className="resource-card"
                onClick={() => {
                  onSelect(item.id);
                }}
              >
                <span className="resource-kind">
                  {kindNames[item.kind]} · v{item.currentVersion}
                </span>
                <strong>{item.title}</strong>
                <span>
                  {item.isGuidance ? "소유자 지정 지침" : "일반 자료"}
                </span>
                <span>
                  {item.versionId
                    ? item.versionAvailable
                      ? (versions.find((v) => v.id === item.versionId)?.name ??
                        "버전 이름 미확인")
                      : "사용할 수 없는 버전"
                    : "프로젝트 공통"}
                </span>
                <small>등록 {dateText(item.createdAt, true)}</small>
                <small>수정 {dateText(item.updatedAt, true)}</small>
              </button>
            ))}
          </div>
        </>
      )}
      {creating && (
        <ResourceEditor
          data={data}
          projectId={projectId}
          versionId={scopeVersion === "common" ? "" : scopeVersion}
          onClose={() => {
            setCreating(false);
          }}
          onSaved={(next) => {
            setConfirmed(next);
            setCreating(false);
            onSelect(next.resource.id);
          }}
        />
      )}
    </section>
  );
}
