import React, { useRef, useState } from "react";
import {
  issueResourceLinkSchema,
  resourceSchema,
  resourceDetailSchema,
  type IssueResourceLink,
} from "../../../server/contracts/resources.js";
import { issueDetailSchema } from "../../../server/response-schemas.js";
import type { Issue } from "../../../server/types.js";
import { Modal, Field, ErrorNotice } from "../../components.js";
import { api, json, errorText, ApiError } from "../../api.js";
import { navigate } from "../../router.js";
import { dateText } from "../../format.js";
import { useViewResource } from "../views/useViewResource.js";
const linksSchema = issueResourceLinkSchema.array(),
  listSchema = resourceSchema.array();
export function IssueResources({
  issue,
  canWrite,
  onChanged,
}: {
  issue: Issue;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const path = `/issues/${issue.id}/resources`,
    resource = useViewResource(path, linksSchema, true, issue.revision);
  const [picker, setPicker] = useState(false),
    [removing, setRemoving] = useState<{
      link: IssueResourceLink;
      revision: number;
    } | null>(null),
    [error, setError] = useState("");
  const writable = canWrite && issue.status !== "closed";
  function changed() {
    void onChanged().catch((e: unknown) => {
      setError(errorText(e));
    });
  }
  return (
    <section
      className="detail-section issue-shared-resources"
      aria-label="공유 자료"
    >
      <div className="section-heading">
        <h3>
          공유 자료 <span>{resource.value?.length ?? 0}</span>
        </h3>
        <div className="resource-actions">
          <button
            type="button"
            disabled={resource.loading}
            onClick={() => {
              void resource.refresh();
              changed();
            }}
          >
            자료 목록 새로고침
          </button>
          {writable && (
            <button
              type="button"
              onClick={() => {
                setPicker(true);
              }}
            >
              기존 자료 연결
            </button>
          )}
        </div>
      </div>
      <ErrorNotice message={error || resource.error} />
      {resource.loading && !resource.value && (
        <div role="status">자료 불러오는 중…</div>
      )}
      {resource.value?.length === 0 && <p>연결된 자료 없음</p>}
      {resource.value?.map((link) => (
        <article className="resource-pinned-card" key={link.id}>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              navigate({
                section: "resources",
                project: issue.projectId,
                resource: link.resource.id,
                resourceVersion: String(link.version.version),
                issue: "",
              });
            }}
          >
            {link.version.title}
          </button>
          <span>고정 버전 {link.version.version}</span>
          <span>
            {link.resource.isGuidance ? "소유자 지정 지침" : "일반 자료"}
          </span>
          {link.resource.deletedAt && <span>원본 삭제됨 · 연결 버전 유지</span>}
          <small>
            {link.version.authorName} · {dateText(link.version.createdAt, true)}
          </small>
          {writable && (
            <button
              type="button"
              aria-label={`${link.version.title} 연결 해제`}
              onClick={() => {
                setRemoving({ link, revision: issue.revision });
              }}
            >
              연결 해제
            </button>
          )}
        </article>
      ))}
      {picker && (
        <ResourcePicker
          issue={issue}
          onClose={() => {
            setPicker(false);
          }}
          onSaved={(link) => {
            resource.accept(
              [
                ...(resource.value ?? []).filter((item) => item.id !== link.id),
                link,
              ],
              path,
            );
            setPicker(false);
            changed();
          }}
        />
      )}
      {removing && (
        <UnlinkResource
          target={removing}
          issueId={issue.id}
          onClose={() => {
            setRemoving(null);
          }}
          onUnlinked={() => {
            resource.accept(
              (resource.value ?? []).filter(
                (item) => item.id !== removing.link.id,
              ),
              path,
            );
            setRemoving(null);
            changed();
          }}
        />
      )}
    </section>
  );
}
function ResourcePicker({
  issue,
  onClose,
  onSaved,
}: {
  issue: Issue;
  onClose: () => void;
  onSaved: (link: IssueResourceLink) => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [number, setNumber] = useState(0),
    [revision, setRevision] = useState(issue.revision),
    [latestIssue, setLatestIssue] = useState<Issue | null>(null),
    [conflict, setConflict] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const list = useViewResource(
      `/resources?${new URLSearchParams({ projectId: issue.projectId, query }).toString()}`,
      listSchema,
    ),
    detail = useViewResource(
      `/resources/${selected}`,
      resourceDetailSchema,
      !!selected,
    );
  const operation = useRef({ fingerprint: "", id: "" });
  const targetVersion = number || detail.value?.resource.currentVersion || 0;
  async function save() {
    if (busy || conflict || !detail.value || !targetVersion) return;
    setBusy(true);
    setError("");
    const payload = {
      resourceId: selected,
      resourceVersion: targetVersion,
      issueRevision: revision,
    };
    const fingerprint = json(payload);
    if (operation.current.fingerprint !== fingerprint)
      operation.current = { fingerprint, id: crypto.randomUUID() };
    try {
      onSaved(
        await api(
          `/issues/${issue.id}/resources`,
          {
            method: "POST",
            body: json({ ...payload, operationId: operation.current.id }),
          },
          issueResourceLinkSchema,
        ),
      );
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="자료 연결"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="editor-form">
        <ErrorNotice message={error || list.error || detail.error} />
        <Field label="연결할 자료 검색">
          <input
            type="search"
            value={query}
            maxLength={200}
            disabled={busy}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </Field>
        <div className="resource-picker-list">
          {list.value?.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={selected === item.id}
              disabled={busy}
              onClick={() => {
                setSelected(item.id);
                setNumber(0);
              }}
            >
              {item.title} · v{item.currentVersion}
            </button>
          ))}
        </div>
        {list.value?.length === 0 && <p>자료 없음</p>}
        {detail.value && (
          <Field label="연결할 내용 버전">
            <select
              value={targetVersion}
              disabled={busy}
              onChange={(e) => {
                setNumber(Number(e.target.value));
              }}
            >
              {detail.value.history.map((version) => (
                <option key={version.version} value={version.version}>
                  v{version.version} · {version.authorName} ·{" "}
                  {dateText(version.createdAt, true)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {conflict && (
          <section className="resource-conflict" aria-label="이슈 충돌 검토">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api(`/issues/${issue.id}`, undefined, issueDetailSchema)
                  .then(
                    (value) => {
                      setLatestIssue(value.issue);
                    },
                    (e: unknown) => {
                      setError(errorText(e));
                    },
                  )
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              최신 이슈 확인
            </button>
            {latestIssue && (
              <>
                <span>
                  {latestIssue.key} · 수정 버전 {latestIssue.revision} ·{" "}
                  {latestIssue.status === "closed" ? "종결" : "미종결"}
                </span>
                <button
                  type="button"
                  disabled={
                    busy ||
                    latestIssue.status === "closed" ||
                    latestIssue.projectId !== issue.projectId
                  }
                  onClick={() => {
                    setRevision(latestIssue.revision);
                    setConflict(false);
                    setLatestIssue(null);
                    setError("");
                  }}
                >
                  이 버전 기준으로 검토
                </button>
              </>
            )}
          </section>
        )}
        <footer className="form-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            disabled={
              busy ||
              conflict ||
              !detail.value ||
              !!detail.value.resource.deletedAt
            }
            onClick={() => {
              void save();
            }}
          >
            {busy ? "연결 중…" : "연결하기"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
function UnlinkResource({
  target,
  issueId,
  onClose,
  onUnlinked,
}: {
  target: { link: IssueResourceLink; revision: number };
  issueId: string;
  onClose: () => void;
  onUnlinked: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const operationId = useRef(crypto.randomUUID());
  async function unlink() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/issues/${issueId}/resources/${target.link.id}`, {
        method: "DELETE",
        body: json({
          issueRevision: target.revision,
          operationId: operationId.current,
        }),
      });
      onUnlinked();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="자료 연결 해제"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="editor-form">
        <strong>
          {target.link.version.title} · v{target.link.version.version}
        </strong>
        <p className="confirm-description">
          이 이슈의 연결만 해제합니다. 원본과 다른 연결은 유지됩니다.
        </p>
        <ErrorNotice message={error} />
        <footer className="form-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void unlink();
            }}
          >
            {busy ? "해제 중…" : "해제하기"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
