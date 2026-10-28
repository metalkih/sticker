import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { Bootstrap, Version } from "../../../server/types.js";
import {
  carryoverPreviewSchema,
  carryoverResultSchema,
  releaseResultSchema,
  type VersionReadiness,
  type CarryoverInput,
  type CarryoverPreview,
  type CarryoverResult,
} from "../../../server/contracts/releases.js";
import { api, json, errorText } from "../../api.js";
import { Modal, Field, ErrorNotice } from "../../components.js";
import { statusNames, versionStateNames } from "../../format.js";
import { registerRouteGuard } from "../../router.js";
import { FetchStamp } from "../sessions/shared.js";
import ChangelogEditor from "./ChangelogEditor.js";
export default function ReleaseReview({
  readiness: ready,
  data,
  onClose,
  onChanged,
  lastFetched,
  refreshError,
}: {
  readiness: VersionReadiness;
  lastFetched: string | null;
  refreshError: string;
  data: Bootstrap;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const destinations = data.versions.filter(
      (v) =>
        v.projectId === ready.version.projectId &&
        v.id !== ready.version.id &&
        v.state === "planned",
    ),
    scope = [
      ...new Map(
        [...ready.targetIssues, ...ready.foundIssues, ...ready.fixedIssues].map(
          (i) => [i.id, i],
        ),
      ).values(),
    ];
  const [destination, setDestination] = useState(destinations[0]?.id ?? ""),
    [selected, setSelected] = useState(
      ready.targetIssues.filter((i) => i.status !== "closed").map((i) => i.id),
    ),
    [preview, setPreview] = useState<CarryoverPreview | null>(null),
    [input, setInput] = useState<CarryoverInput | null>(null),
    [results, setResults] = useState<CarryoverResult | null>(null),
    [busy, setBusy] = useState(false),
    [draftBusy, setDraftBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState(false),
    [state, setState] = useState<Version["state"]>(
      ready.version.state === "released" ? "planned" : "released",
    );
  const operation = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!dirty) return;
    const before = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("beforeunload", before);
    };
  }, [dirty]);
  useEffect(() => {
    if (!dirty && !busy && !draftBusy) return;
    return registerRouteGuard((next) => {
      if (next.section === "versions" && next.version === ready.version.id)
        return true;
      if (busy || draftBusy) return false;
      return window.confirm("저장하지 않은 변경로그 초안을 버리고 이동할까요?");
    });
  }, [dirty, busy, draftBusy, ready.version.id]);
  function close() {
    if (busy || draftBusy) return;
    if (
      dirty &&
      !window.confirm("저장하지 않은 변경로그 초안을 버리고 닫을까요?")
    )
      return;
    onClose();
  }
  async function previewMove() {
    if (busy) return;
    const target = destinations.find((v) => v.id === destination);
    if (!target) return;
    setBusy(true);
    setError("");
    setResults(null);
    try {
      const next = {
        revision: ready.version.revision,
        destinationVersionId: target.id,
        destinationRevision: target.revision,
        operationId: crypto.randomUUID(),
        issues: ready.targetIssues
          .filter((i) => selected.includes(i.id))
          .map((i) => ({ issueId: i.id, revision: i.revision })),
      };
      const result = await api(
        `/versions/${encodeURIComponent(ready.version.id)}/carryover/preview`,
        { method: "POST", body: json(next) },
        carryoverPreviewSchema,
      );
      setPreview(result);
      setInput(next);
    } catch (e) {
      setError(errorText(e));
      setInput(null);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  async function move() {
    if (!input || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/versions/${encodeURIComponent(ready.version.id)}/carryover`,
        { method: "POST", body: json(input) },
        carryoverResultSchema,
      );
      setResults(result);
      setInput(null);
      setPreview(null);
      setSelected([]);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function release() {
    if (busy || !confirm) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/versions/${encodeURIComponent(ready.version.id)}/release`,
        {
          method: "POST",
          body: json({
            revision: ready.version.revision,
            operationId: operation.current,
            confirm: true,
            state,
          }),
        },
        releaseResultSchema,
      );
      setNotice("출시 상태가 기록되었습니다.");
      setConfirm(false);
      operation.current = crypto.randomUUID();
      await onChanged();
    } catch (e) {
      setError(errorText(e));
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <Modal title={`${ready.version.name} 출시 검토`} onClose={close} wide>
      <div className="editor-form release-review">
        <FetchStamp value={lastFetched} failed={!!refreshError} />
        <ErrorNotice message={error || refreshError} />
        {notice && <p role="status">{notice}</p>}
        <section aria-label="출시 전 점검">
          <h3>
            미종결{" "}
            {ready.targetIssues.filter((i) => i.status !== "closed").length} ·
            차단 {ready.counts.blocked}
          </h3>
          <div className="release-carryover">
            <fieldset disabled={busy}>
              <legend>다음 버전으로 이관할 이슈</legend>
              {ready.targetIssues
                .filter((i) => i.status !== "closed")
                .map((issue) => (
                  <label className="release-check" key={issue.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(issue.id)}
                      onChange={(event) => {
                        setSelected(
                          event.target.checked
                            ? [...selected, issue.id]
                            : selected.filter((id) => id !== issue.id),
                        );
                        setInput(null);
                        setPreview(null);
                      }}
                    />
                    <span>
                      {issue.key} · {issue.title}
                      <small>
                        {statusNames[issue.status]}
                        {ready.blockedIssueIds.includes(issue.id)
                          ? " · 차단"
                          : ""}
                      </small>
                    </span>
                  </label>
                ))}
              {!ready.targetIssues.some((i) => i.status !== "closed") && (
                <p>미종결 이슈 없음</p>
              )}
            </fieldset>
            <Field label="이관할 다음 버전">
              <select
                value={destination}
                disabled={busy}
                onChange={(event) => {
                  setDestination(event.target.value);
                  setInput(null);
                  setPreview(null);
                }}
              >
                {!destinations.length && (
                  <option value="">계획 버전 없음</option>
                )}
                {destinations.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <button
              className="button secondary"
              disabled={
                busy ||
                !destinations.some((v) => v.id === destination) ||
                !selected.length
              }
              onClick={() => void previewMove()}
            >
              이관 미리보기
            </button>
            {preview && (
              <div aria-label="이관 미리보기 결과">
                {preview.items.map((item) => (
                  <p key={item.issue.id}>
                    {item.issue.key} · {item.issue.title} ·{" "}
                    <strong>
                      {item.outcome === "ready"
                        ? "이관 가능"
                        : item.outcome === "denied"
                          ? "이관 권한 없음"
                          : "충돌"}
                    </strong>
                  </p>
                ))}
                <button
                  className="button primary"
                  disabled={busy || !input}
                  onClick={() => void move()}
                >
                  선택 이슈 이관
                </button>
              </div>
            )}
            {results && (
              <div aria-label="이관 처리 결과" role="status">
                {results.items.map((item) => (
                  <p key={item.issueId}>
                    {data.issues.find((i) => i.id === item.issueId)?.key ??
                      item.issueId}{" "}
                    ·{" "}
                    {item.outcome === "moved"
                      ? "이관 완료"
                      : item.outcome === "conflict"
                        ? "충돌 · 최신 이슈 확인"
                        : "이관 실패"}
                    {item.code ? ` (${item.code})` : ""}
                  </p>
                ))}
              </div>
            )}
          </div>
        </section>
        <ChangelogEditor
          versionId={ready.version.id}
          issues={scope}
          onDirty={setDirty}
          onPending={setDraftBusy}
        />
        {data.actor.role === "owner" && data.actor.canWrite && (
          <section className="release-confirm" aria-label="소유자 출시 확인">
            <h3>출시 상태 변경</h3>
            <Field label="변경할 출시 상태">
              <select
                value={state}
                disabled={busy}
                onChange={(event) => {
                  setState(event.target.value as Version["state"]);
                  setConfirm(false);
                  operation.current = crypto.randomUUID();
                }}
              >
                {(["released", "planned", "archived"] as const).map((value) => (
                  <option value={value} key={value}>
                    {versionStateNames[value]}
                  </option>
                ))}
              </select>
            </Field>
            <label className="release-check">
              <input
                type="checkbox"
                checked={confirm}
                disabled={busy}
                onChange={(event) => {
                  setConfirm(event.target.checked);
                }}
              />
              {ready.version.name}의 {versionStateNames[state]} 상태 기록을
              확인합니다
            </label>
            <button
              className="button primary"
              disabled={
                busy ||
                draftBusy ||
                dirty ||
                !confirm ||
                state === ready.version.state
              }
              onClick={() => void release()}
            >
              {busy ? "기록 중…" : "출시 상태 확정"}
            </button>
          </section>
        )}
        <footer className="form-actions">
          <button
            className="button secondary"
            disabled={busy || draftBusy}
            onClick={close}
          >
            취소
          </button>
        </footer>
      </div>
    </Modal>,
    document.body,
  );
}
