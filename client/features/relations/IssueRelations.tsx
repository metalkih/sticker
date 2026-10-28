import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Bootstrap, Issue } from "../../../server/types.js";
import {
  relationDetailSchema,
  relationSchema,
  type RelationDetail,
  type IssueRelation,
} from "../../../server/contracts/relations.js";
import { api, json, errorText } from "../../api.js";
import { ErrorNotice, Field, Modal, StatusPill } from "../../components.js";
type Choice = "parent" | "child" | "related" | "blocks" | "blockedBy";
export function IssueRelations({
  issue,
  data,
  onChanged,
  onOpen,
}: {
  issue: Issue;
  data: Bootstrap;
  onChanged: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [detail, setDetail] = useState<RelationDetail | null>(null),
    [error, setError] = useState(""),
    [picker, setPicker] = useState(false),
    [busy, setBusy] = useState(false),
    [loadedAt, setLoadedAt] = useState("");
  const sequence = useRef(0);
  const reload = useCallback(() => {
    const ticket = ++sequence.current;
    return api(
      `/issues/${issue.id}/relations`,
      undefined,
      relationDetailSchema,
    ).then(
      (value) => {
        if (ticket !== sequence.current) return;
        setDetail(value);
        setError("");
        setLoadedAt(new Date().toLocaleTimeString());
      },
      (e: unknown) => {
        if (ticket !== sequence.current) return;
        setError(errorText(e));
      },
    );
  }, [issue.id]);
  useEffect(() => {
    void reload();
    return () => {
      sequence.current += 1;
    };
  }, [reload, issue.revision]);
  async function remove(edge: IssueRelation) {
    if (busy || !detail) return;
    sequence.current += 1;
    setBusy(true);
    setError("");
    try {
      const linked = [
        ...detail.children,
        ...detail.related,
        ...detail.blockerRelations,
        ...detail.blocking,
        ...(detail.parent ? [detail.parent] : []),
      ].find((x) => x.relation.id === edge.id)?.issue;
      if (!linked)
        throw new Error("관계 대상이 변경되었습니다. 새로고침하세요.");
      await api(`/relations/${edge.id}`, {
        method: "DELETE",
        body: json({
          sourceRevision:
            edge.sourceIssueId === issue.id ? issue.revision : linked.revision,
          targetRevision:
            edge.targetIssueId === issue.id ? issue.revision : linked.revision,
        }),
      });
      await reload();
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const groups = detail
    ? [
        { name: "부모 이슈", entries: detail.parent ? [detail.parent] : [] },
        { name: "하위 이슈", entries: detail.children },
        { name: "차단 원인", entries: detail.blockerRelations },
        { name: "이 이슈가 차단", entries: detail.blocking },
        { name: "관련 이슈", entries: detail.related },
      ]
    : [];
  const writable =
    data.actor.canWrite &&
    (issue.status !== "closed" || data.actor.role === "owner");
  return (
    <section className="issue-relations" aria-label="이슈 관계">
      <div className="relations-heading">
        <h3>이슈 관계</h3>
        <button
          className="text-button"
          onClick={() => {
            void reload();
          }}
        >
          관계 새로고침
        </button>
        {writable && (
          <button
            className="text-button"
            onClick={() => {
              setPicker(true);
            }}
          >
            관계 추가
          </button>
        )}
      </div>
      <ErrorNotice message={error} />
      {error && detail && (
        <p role="status">
          이전 관계 정보입니다. 최신 상태를 확인하지 못했어요. 마지막 확인:{" "}
          {loadedAt}
        </p>
      )}
      {!detail && !error && <p role="status">관계를 불러오는 중…</p>}
      {detail && groups.every((g) => !g.entries.length) && (
        <p className="muted">연결된 이슈가 없어요.</p>
      )}
      {groups
        .filter((g) => g.entries.length)
        .map((g) => (
          <div key={g.name} className="relation-group">
            <h4>{g.name}</h4>
            <ul>
              {g.entries.map(({ relation, issue: other }) => (
                <li key={relation.id}>
                  <button
                    className="relation-link"
                    onClick={() => {
                      onOpen(other.id);
                    }}
                  >
                    <span>{other.key}</span> {other.title}{" "}
                    <StatusPill status={other.status} />
                  </button>
                  {g.name === "차단 원인" && (
                    <span className="relation-state">
                      {other.status === "closed"
                        ? "차단 해소"
                        : "차단됨 · 소유자 종결 전"}
                    </span>
                  )}
                  {writable && (
                    <button
                      className="text-button"
                      disabled={busy}
                      aria-label={`${other.key} 관계 해제`}
                      onClick={() => {
                        void remove(relation);
                      }}
                    >
                      해제
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      {picker && (
        <RelationPicker
          issue={issue}
          data={data}
          onClose={() => {
            setPicker(false);
          }}
          onSaved={async () => {
            await reload();
            await onChanged();
            setPicker(false);
          }}
        />
      )}
    </section>
  );
}
export function RelationPicker({
  issue,
  data,
  onClose,
  onSaved,
}: {
  issue: Issue;
  data: Bootstrap;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [choice, setChoice] = useState<Choice>("related"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const candidates = data.issues.filter(
    (i) =>
      i.id !== issue.id &&
      i.projectId === issue.projectId &&
      `${i.key} ${i.title}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  async function save() {
    if (busy || !selected) return;
    setBusy(true);
    setError("");
    try {
      const other = data.issues.find((i) => i.id === selected);
      if (!other)
        throw new Error("선택한 이슈가 삭제되었거나 접근할 수 없습니다.");
      const reverse = choice === "parent" || choice === "blockedBy",
        source = reverse ? other : issue,
        target = reverse ? issue : other;
      await api(
        `/issues/${source.id}/relations`,
        {
          method: "POST",
          body: json({
            kind:
              choice === "child" || choice === "parent"
                ? "parent"
                : choice === "related"
                  ? "related"
                  : "blocks",
            targetIssueId: target.id,
            sourceRevision: source.revision,
            targetRevision: target.revision,
          }),
        },
        relationSchema,
      );
      await onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="관계 추가"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ErrorNotice message={error} />
        <Field label="관계 종류">
          <select
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value as Choice);
            }}
          >
            <option value="related">관련 이슈</option>
            <option value="parent">선택한 이슈를 부모로</option>
            <option value="child">선택한 이슈를 하위로</option>
            <option value="blocks">이 이슈가 선택한 이슈를 차단</option>
            <option value="blockedBy">선택한 이슈가 이 이슈를 차단</option>
          </select>
        </Field>
        <Field label="이슈 검색">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="같은 프로젝트의 키 또는 제목"
          />
        </Field>
        <div className="relation-candidates" aria-label="관계 대상 검색 결과">
          {candidates.map((i) => (
            <button
              type="button"
              key={i.id}
              className="relation-candidate"
              aria-pressed={selected === i.id}
              onClick={() => {
                setSelected(i.id);
              }}
            >
              {i.key} · {i.title} <StatusPill status={i.status} />
            </button>
          ))}
          {!candidates.length && <p>검색 결과가 없어요.</p>}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            취소
          </button>
          <button className="button primary" disabled={busy || !selected}>
            {busy ? "연결 중…" : "연결하기"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
