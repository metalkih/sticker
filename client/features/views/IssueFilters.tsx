import React, { useState } from "react";
import {
  STATUSES,
  type Bootstrap,
  type Status,
} from "../../../server/types.js";
import type { IssueQuery } from "../../../server/contracts/issue-query.js";
import { statusNames, priorityNames } from "../../format.js";
import { Icon } from "../../components.js";
const versionFields = [
  ["targetVersionId", "목표 버전"],
  ["foundVersionId", "발견 버전"],
  ["fixedVersionId", "수정 버전"],
] as const;
const labels: Partial<Record<keyof IssueQuery, string>> = {
  query: "검색",
  status: "상태",
  priority: "우선순위",
  assignee: "담당자",
  labels: "라벨",
  targetVersionId: "목표 버전",
  foundVersionId: "발견 버전",
  fixedVersionId: "수정 버전",
  blocked: "차단",
  inputRequested: "입력 요청",
};
export function IssueFilters({
  data,
  query,
  onChange,
}: {
  data: Bootstrap;
  query: IssueQuery;
  onChange: (query: IssueQuery) => void;
}) {
  const labelsKey = query.labels?.join(", ") ?? "";
  const [labelDraft, setLabelDraft] = useState(labelsKey);
  const [previousLabels, setPreviousLabels] = useState(labelsKey);
  if (previousLabels !== labelsKey) {
    setPreviousLabels(labelsKey);
    setLabelDraft(labelsKey);
  }
  function patch(next: Partial<IssueQuery>) {
    onChange({ ...query, ...next });
  }
  const versions = data.versions.filter(
      (v) => !query.projectId || v.projectId === query.projectId,
    ),
    assignees = [
      ...new Set(
        data.issues
          .filter((i) => !query.projectId || i.projectId === query.projectId)
          .map((i) => i.assignee)
          .filter(Boolean),
      ),
    ];
  const chips = Object.entries(labels).filter(
    ([key]) =>
      query[key as keyof IssueQuery] !== undefined &&
      query[key as keyof IssueQuery] !== "",
  );
  return (
    <>
      <div className="filters saved-view-filters">
        <label className="search-field">
          <Icon name="search" size={16} />
          <input
            aria-label="이슈 검색"
            placeholder="이슈 검색…"
            maxLength={200}
            value={query.query ?? ""}
            onChange={(e) => {
              patch({ query: e.target.value || undefined });
            }}
          />
          <kbd>/</kbd>
        </label>
        <select
          aria-label="상태 필터"
          value={
            query.status?.length === 1
              ? query.status[0]
              : query.status
                ? "__multiple"
                : ""
          }
          onChange={(e) => {
            patch({
              status: e.target.value ? [e.target.value as Status] : undefined,
            });
          }}
        >
          <option value="">모든 상태</option>
          {query.status && query.status.length > 1 && (
            <option value="__multiple" disabled>
              여러 상태
            </option>
          )}
          {STATUSES.map((s) => (
            <option value={s} key={s}>
              {statusNames[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="우선순위 필터"
          value={
            query.priority?.length === 1
              ? query.priority[0]
              : query.priority
                ? "__multiple"
                : ""
          }
          onChange={(e) => {
            patch({
              priority: e.target.value
                ? [
                    e.target.value as NonNullable<
                      IssueQuery["priority"]
                    >[number],
                  ]
                : undefined,
            });
          }}
        >
          <option value="">모든 우선순위</option>
          {query.priority && query.priority.length > 1 && (
            <option value="__multiple" disabled>
              여러 우선순위
            </option>
          )}
          {Object.entries(priorityNames).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="담당자 필터"
          value={query.assignee === undefined ? "" : query.assignee || "__none"}
          onChange={(e) => {
            patch({
              assignee:
                e.target.value === "__none" ? "" : e.target.value || undefined,
            });
          }}
        >
          <option value="">모든 담당자</option>
          <option value="__none">미지정</option>
          {query.assignee && !assignees.includes(query.assignee) && (
            <option value={query.assignee}>{query.assignee}</option>
          )}
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {versionFields.map(([field, label]) => (
          <select
            key={field}
            aria-label={`${label} 필터`}
            value={query[field] === null ? "__none" : (query[field] ?? "")}
            onChange={(e) => {
              patch({
                [field]:
                  e.target.value === "__none"
                    ? null
                    : e.target.value || undefined,
              });
            }}
          >
            <option value="">모든 {label}</option>
            <option value="__none">{label} 미지정</option>
            {query[field] && !versions.some((v) => v.id === query[field]) && (
              <option value={query[field] ?? ""}>삭제된 버전</option>
            )}
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        ))}
        <input
          className="view-label-filter"
          aria-label="라벨 필터"
          placeholder="라벨"
          maxLength={400}
          value={labelDraft}
          onChange={(e) => {
            setLabelDraft(e.target.value);
          }}
          onBlur={() => {
            const values = labelDraft
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean);
            patch({ labels: values.length ? values : undefined });
          }}
        />
        <select
          aria-label="차단 필터"
          value={query.blocked === undefined ? "" : String(query.blocked)}
          onChange={(e) => {
            patch({
              blocked: e.target.value ? e.target.value === "true" : undefined,
            });
          }}
        >
          <option value="">모든 차단 상태</option>
          <option value="true">차단됨</option>
          <option value="false">차단 없음</option>
        </select>
        <select
          aria-label="입력 요청 필터"
          value={
            query.inputRequested === undefined
              ? ""
              : String(query.inputRequested)
          }
          onChange={(e) => {
            patch({
              inputRequested: e.target.value
                ? e.target.value === "true"
                : undefined,
            });
          }}
        >
          <option value="">모든 입력 요청</option>
          <option value="true">입력 요청 있음</option>
          <option value="false">입력 요청 없음</option>
        </select>
        <select
          aria-label="정렬"
          value={query.sort}
          onChange={(e) => {
            patch({ sort: e.target.value as IssueQuery["sort"] });
          }}
        >
          <option value="updated_desc">최근 변경순</option>
          <option value="created_desc">최근 등록순</option>
          <option value="priority_desc">우선순위순</option>
          <option value="key_asc">이슈 번호순</option>
        </select>
        {chips.length > 0 && (
          <button
            className="text-button clear-filters"
            onClick={() => {
              onChange({
                projectId: query.projectId,
                sort: query.sort,
                mode: query.mode,
              });
            }}
          >
            초기화
          </button>
        )}
      </div>
      {chips.length > 0 && (
        <div className="view-filter-chips">
          {chips.map(([key, label]) => (
            <button
              key={key}
              className="view-filter-chip"
              aria-label={`${label} 필터 제거`}
              onClick={() => {
                patch({ [key]: undefined });
              }}
            >
              {label} ×
            </button>
          ))}
        </div>
      )}
    </>
  );
}
