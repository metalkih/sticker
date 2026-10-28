import { ResourceContent } from "./ResourceContent.js";
import React, { useRef, useState } from "react";
import {
  resourceDetailSchema,
  MAX_RESOURCE_FILE_BYTES,
  type ResourceDetail,
} from "../../../server/contracts/resources.js";
import type { Bootstrap } from "../../../server/types.js";
import { Modal, Field, ErrorNotice } from "../../components.js";
import { api, json, errorText, ApiError } from "../../api.js";
import { useDraftGuard } from "../templates/useDraftGuard.js";
import { SafeMarkdown } from "./SafeMarkdown.js";
export function ResourceEditor({
  data,
  projectId,
  versionId = "",
  initial,
  onClose,
  onSaved,
}: {
  data: Bootstrap;
  projectId: string;
  versionId?: string;
  initial?: ResourceDetail;
  onClose: () => void;
  onSaved: (detail: ResourceDetail) => void;
}) {
  const [kind, setKind] = useState(initial?.resource.kind ?? "markdown"),
    [title, setTitle] = useState(initial?.resource.title ?? ""),
    [scope, setScope] = useState(initial?.resource.versionId ?? versionId),
    [markdown, setMarkdown] = useState(
      initial?.current?.kind === "markdown" ? initial.current.markdown : "",
    ),
    [url, setUrl] = useState(
      initial?.current?.kind === "link" ? initial.current.url : "",
    ),
    [file, setFile] = useState<File | null>(null),
    [fileKey, setFileKey] = useState(""),
    [revision, setRevision] = useState(initial?.resource.revision ?? 0),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<ResourceDetail | null>(null),
    [loadingLatest, setLoadingLatest] = useState(false),
    [preview, setPreview] = useState(false);
  const [initialFields] = useState(
      json({ kind, title, scope, markdown, url, fileKey }),
    ),
    operation = useRef({ fingerprint: "", id: "" }),
    controller = useRef<AbortController | null>(null);
  const dirty =
    json({ kind, title, scope, markdown, url, fileKey }) !== initialFields;
  const guard = useDraftGuard(dirty, busy);
  const versions = data.versions.filter((v) => v.projectId === projectId);
  function op(fingerprint: string) {
    if (operation.current.fingerprint !== fingerprint)
      operation.current = { fingerprint, id: crypto.randomUUID() };
    return operation.current.id;
  }
  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || conflict || loadingLatest) return;
    if (!title.trim()) {
      setError("제목을 입력하세요.");
      return;
    }
    if (kind === "file" && !initial && !file) {
      setError("파일을 선택하세요.");
      return;
    }
    if (file && file.size > MAX_RESOURCE_FILE_BYTES) {
      setError("파일은 20 MiB 이하여야 합니다.");
      return;
    }
    const payload = {
      title: title.trim(),
      versionId: scope || null,
      ...(kind === "markdown"
        ? { markdown }
        : kind === "link"
          ? { url: url.trim() }
          : {}),
      ...(initial ? { revision } : { projectId, kind }),
    };
    const operationId = op(json({ payload, fileKey }));
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(true);
    setError("");
    try {
      let result: ResourceDetail;
      if (kind === "file" && file) {
        const body = new FormData();
        body.set("file", file);
        body.set(
          "metadata",
          json({
            title: title.trim(),
            versionId: scope || null,
            operationId,
            ...(initial ? { revision } : {}),
          }),
        );
        result = await api(
          initial
            ? `/resources/${initial.resource.id}/files`
            : `/projects/${projectId}/resources/files`,
          { method: "POST", body, signal: requestController.signal },
          resourceDetailSchema,
        );
      } else
        result = await api(
          initial ? `/resources/${initial.resource.id}` : "/resources",
          {
            method: initial ? "PATCH" : "POST",
            body: json({ ...payload, operationId }),
            signal: requestController.signal,
          },
          resourceDetailSchema,
        );
      setUncertain(false);
      guard.proceed(() => {
        onSaved(result);
      });
    } catch (e) {
      setUncertain(
        (previous) =>
          previous ||
          !(e instanceof ApiError) ||
          e.status >= 500 ||
          e.status === 408,
      );
      setError(
        requestController.signal.aborted
          ? "전송 응답 미확인 · 같은 입력으로 다시 저장하여 확인하세요."
          : errorText(e),
      );
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setLatest(null);
      }
    } finally {
      controller.current = null;
      setBusy(false);
    }
  }
  async function review() {
    if (!initial || loadingLatest) return;
    setLoadingLatest(true);
    try {
      setLatest(
        await api(
          `/resources/${initial.resource.id}`,
          undefined,
          resourceDetailSchema,
        ),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingLatest(false);
    }
  }
  return (
    <Modal
      title={initial ? "자료 편집" : "자료 등록"}
      onClose={() => {
        guard.leave(onClose);
      }}
      wide
    >
      <form
        className="editor-form resource-editor"
        onSubmit={(e) => {
          void save(e);
        }}
      >
        <ErrorNotice message={error} />
        {uncertain && (
          <span role="status">전송 결과 미확인 · 기존 입력 재시도</span>
        )}
        {conflict && (
          <section className="resource-conflict" aria-label="자료 충돌 검토">
            <button
              type="button"
              disabled={loadingLatest}
              onClick={() => {
                void review();
              }}
            >
              최신 자료 확인
            </button>
            {latest && (
              <>
                <strong>{latest.resource.title}</strong>
                <span>내용 버전 {latest.resource.currentVersion}</span>
                <span>수정 버전 {latest.resource.revision}</span>
                {latest.current && (
                  <section aria-label="최신 자료 내용">
                    <ResourceContent
                      key={`${latest.resource.id}:${String(latest.current.version)}`}
                      version={latest.current}
                    />
                  </section>
                )}
                {latest.resource.deletedAt ? (
                  <span>삭제된 자료</span>
                ) : (
                  <button
                    type="button"
                    disabled={
                      loadingLatest ||
                      (latest.resource.isGuidance &&
                        data.actor.role !== "owner")
                    }
                    onClick={() => {
                      setRevision(latest.resource.revision);
                      setConflict(false);
                      setLatest(null);
                      setError("");
                      operation.current = { fingerprint: "", id: "" };
                    }}
                  >
                    이 버전 기준으로 검토
                  </button>
                )}
              </>
            )}
          </section>
        )}
        <Field label="자료 종류">
          <select
            value={kind}
            disabled={!!initial || busy || uncertain}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "markdown" || value === "link" || value === "file")
                setKind(value);
            }}
          >
            <option value="markdown">문서</option>
            <option value="link">링크</option>
            <option value="file">파일</option>
          </select>
        </Field>
        <Field label="자료 제목">
          <input
            value={title}
            maxLength={255}
            required
            disabled={busy || uncertain}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </Field>
        <Field label="자료 버전 범위">
          <select
            value={scope}
            disabled={busy || uncertain}
            onChange={(e) => {
              setScope(e.target.value);
            }}
          >
            <option value="">프로젝트 공통</option>
            {scope && !versions.some((v) => v.id === scope) && (
              <option value={scope}>사용할 수 없는 버전</option>
            )}
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        {kind === "markdown" && (
          <>
            <Field label="Markdown 내용">
              <textarea
                rows={12}
                value={markdown}
                maxLength={100000}
                disabled={busy || uncertain}
                onChange={(e) => {
                  setMarkdown(e.target.value);
                }}
              />
            </Field>
            <button
              type="button"
              aria-expanded={preview}
              onClick={() => {
                setPreview(!preview);
              }}
            >
              미리보기
            </button>
            {preview && (
              <section aria-label="문서 미리보기">
                <SafeMarkdown value={markdown} />
              </section>
            )}
          </>
        )}
        {kind === "link" && (
          <Field label="외부 URL">
            <input
              type="url"
              value={url}
              required
              maxLength={4096}
              disabled={busy || uncertain}
              onChange={(e) => {
                setUrl(e.target.value);
              }}
            />
          </Field>
        )}
        {kind === "file" && (
          <Field label={initial ? "새 파일 버전" : "파일 선택"}>
            <input
              type="file"
              disabled={busy || uncertain}
              required={!initial}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setFileKey(crypto.randomUUID());
              }}
            />
          </Field>
        )}
        <footer className="form-actions">
          {busy && file && (
            <button
              type="button"
              onClick={() => {
                controller.current?.abort();
              }}
            >
              전송 취소
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              guard.leave(onClose);
            }}
          >
            취소
          </button>
          <button type="submit" disabled={busy || conflict || loadingLatest}>
            {busy ? (file ? "업로드 중…" : "저장 중…") : "저장"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
