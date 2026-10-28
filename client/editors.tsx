import { readinessSchema } from "../server/contracts/releases.js";
import {
  projectSchema,
  issueSchema,
  issueDetailSchema,
} from "../server/response-schemas.js";
import React, { useState } from "react";
import type { Bootstrap, Issue, Project, Version } from "../server/types.js";
import { STATUSES } from "../server/types.js";
import { api, json, errorText, ApiError } from "./api.js";
import { Modal, Field, ErrorNotice } from "./components.js";
import { statusNames, priorityNames, versionStateNames } from "./format.js";
const colors = [
  "#d7f45b",
  "#bcb0ee",
  "#ff9d7d",
  "#7fcac2",
  "#8eb7ee",
  "#e9bb65",
];
export function ProjectEditor({
  project,
  onClose,
  onSaved,
}: {
  project?: Project;
  onClose: () => void;
  onSaved: (project: Project) => void | Promise<void>;
}) {
  const [name, setName] = useState(project?.name || "");
  const [key, setKey] = useState(project?.key || "");
  const [description, setDescription] = useState(project?.description || "");
  const [color, setColor] = useState(project?.color || colors[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        project ? `/projects/${project.id}` : "/projects",
        {
          method: project ? "PATCH" : "POST",
          body: json({ name, key, description, color }),
        },
        projectSchema,
      );
      await onSaved(result);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={project ? "프로젝트 편집" : "새로운 프로젝트"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        className="editor-form"
      >
        <Field label="프로젝트 이름">
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="프로젝트 이름"
          />
        </Field>
        <Field label="프로젝트 키">
          <input
            required
            pattern="[A-Z][A-Z0-9]{1,7}"
            maxLength={8}
            value={key}
            onChange={(e) => {
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
            }}
            placeholder="예: STK"
          />
          <small>A–Z로 시작 · A–Z/0–9 · 2–8자</small>
        </Field>
        <Field label="프로젝트 설명">
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            rows={3}
            maxLength={10000}
            placeholder="목표 · 범위"
          />
        </Field>
        <fieldset className="color-field">
          <legend>스티커 색상</legend>
          <div className="color-options">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                style={{ background: c }}
                className={color === c ? "selected" : ""}
                onClick={() => {
                  setColor(c);
                }}
                aria-label={`${c} 색상`}
                aria-pressed={color === c}
              >
                {color === c ? "✓" : ""}
              </button>
            ))}
          </div>
        </fieldset>
        <ErrorNotice message={error} />
        <footer className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            취소
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "저장 중…" : project ? "변경 저장" : "프로젝트 만들기"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function VersionEditor({
  version,
  data,
  projectId,
  onClose,
  onSaved,
  onReview,
}: {
  version?: Version;
  data: Bootstrap;
  projectId?: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onReview?: (version: Version) => void;
}) {
  const [project, setProject] = useState(
    version?.projectId || projectId || data.projects[0]?.id || "",
  );
  const [name, setName] = useState(version?.name || "");
  const [description, setDescription] = useState(version?.description || "");
  const [state, setState] = useState<Version["state"]>(
    version?.state || "planned",
  );
  const [dueDate, setDueDate] = useState(version?.dueDate?.slice(0, 10) || "");
  const [revision, setRevision] = useState(version?.revision ?? 1);
  const [latest, setLatest] = useState<Version | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(version ? `/versions/${version.id}` : "/versions", {
        method: version ? "PATCH" : "POST",
        body: json({
          ...(version ? { revision } : { projectId: project }),
          name,
          description,
          ...(state === "released" ? {} : { state }),
          dueDate: dueDate || null,
        }),
      });
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT")
        setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={version ? "버전 편집" : "새로운 버전"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        className="editor-form"
      >
        <div className="form-grid">
          <Field label="프로젝트">
            <select
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
              }}
              disabled={!!version}
              required
            >
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="버전 이름">
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="예: v1.0.0"
            />
          </Field>
          <Field label="버전 상태">
            {version?.state === "released" ? (
              <span>{versionStateNames.released}</span>
            ) : (
              <select
                value={state}
                onChange={(e) => {
                  setState(e.target.value as Version["state"]);
                }}
              >
                {Object.entries(versionStateNames)
                  .filter(([value]) => value !== "released")
                  .map(([v, n]) => (
                    <option value={v} key={v}>
                      {n}
                    </option>
                  ))}
              </select>
            )}
            {version && onReview && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  onReview(version);
                }}
              >
                출시 검토
              </button>
            )}
          </Field>
          <Field label="목표 날짜">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
              }}
            />
          </Field>
        </div>
        <Field label="버전 설명">
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            rows={4}
            maxLength={10000}
            placeholder="이번 버전에서 달라지는 점"
          />
        </Field>
        <ErrorNotice message={error} />
        {conflict && version && (
          <div className="release-conflict">
            {latest ? (
              <>
                <span>
                  서버 최신 버전: {latest.name} · r{latest.revision}
                </span>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setRevision(latest.revision);
                    setConflict(false);
                    setLatest(null);
                    setError("");
                  }}
                >
                  최신 버전 기준으로 초안 유지
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    try {
                      setLatest(
                        (
                          await api(
                            `/versions/${version.id}/readiness`,
                            undefined,
                            readinessSchema,
                          )
                        ).version,
                      );
                    } catch (e) {
                      setError(errorText(e));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                최신 버전 검토
              </button>
            )}
          </div>
        )}

        <footer className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            취소
          </button>
          <button className="button primary" disabled={busy || conflict}>
            {busy ? "저장 중…" : version ? "변경 저장" : "버전 만들기"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function IssueEditor({
  issue,
  data,
  projectId,
  initialStatus = "backlog",
  onClose,
  onSaved,
}: {
  issue?: Issue;
  data: Bootstrap;
  projectId?: string;
  initialStatus?: Issue["status"];
  onClose: () => void;
  onSaved: (issue: Issue) => void | Promise<void>;
}) {
  const [project, setProject] = useState(
    issue?.projectId || projectId || data.projects[0]?.id || "",
  );
  const [title, setTitle] = useState(issue?.title || "");
  const [description, setDescription] = useState(issue?.description || "");
  const [status, setStatus] = useState<Issue["status"]>(
    issue?.status || initialStatus,
  );
  const [priority, setPriority] = useState<Issue["priority"]>(
    issue?.priority || "medium",
  );
  const [assignee, setAssignee] = useState(issue?.assignee || "");
  const [labels, setLabels] = useState(issue?.labels.join(", ") || "");
  const [target, setTarget] = useState(issue?.targetVersionId || "");
  const [found, setFound] = useState(issue?.foundVersionId || "");
  const [fixed, setFixed] = useState(issue?.fixedVersionId || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(issue?.revision);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<Issue | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const versions = data.versions.filter((v) => v.projectId === project);
  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || conflict) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        issue ? `/issues/${issue.id}` : "/issues",
        {
          method: issue ? "PATCH" : "POST",
          body: json({
            ...(issue ? { revision } : { projectId: project }),
            title,
            description,
            status,
            priority,
            assignee,
            labels: labels
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            targetVersionId: target || null,
            foundVersionId: found || null,
            fixedVersionId: fixed || null,
          }),
        },
        issueSchema,
      );
      await onSaved(result);
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        setConflict(true);
        setLatest(null);
      }
    } finally {
      setBusy(false);
    }
  }
  const versionSelect = (value: string, set: (v: string) => void) => (
    <select
      value={value}
      onChange={(e) => {
        set(e.target.value);
      }}
    >
      <option value="">지정하지 않음</option>
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  );
  return (
    <Modal
      title={issue ? `${issue.key} 편집` : "새로운 스티커"}
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
        className="editor-form"
      >
        <Field label="이슈 제목">
          <input
            className="title-input"
            required
            maxLength={300}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
            placeholder="이슈 제목"
          />
        </Field>
        <Field label="설명">
          <textarea
            rows={5}
            maxLength={50000}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            placeholder="작업 내용 · 완료 기준"
          />
        </Field>
        <div className="form-grid">
          <Field label="프로젝트">
            <select
              value={project}
              disabled={!!issue}
              onChange={(e) => {
                setProject(e.target.value);
                setTarget("");
                setFound("");
                setFixed("");
              }}
              required
            >
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="상태">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as Issue["status"]);
              }}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusNames[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="우선순위">
            <select
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value as Issue["priority"]);
              }}
            >
              {Object.entries(priorityNames).map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="담당자">
            <input
              value={assignee}
              onChange={(e) => {
                setAssignee(e.target.value);
              }}
              maxLength={120}
              placeholder="나, Codex…"
            />
          </Field>
        </div>
        <div className="form-grid three">
          <Field label="목표 버전">{versionSelect(target, setTarget)}</Field>
          <Field label="발견 버전">{versionSelect(found, setFound)}</Field>
          <Field label="수정 버전">{versionSelect(fixed, setFixed)}</Field>
        </div>
        <Field label="라벨">
          <input
            value={labels}
            onChange={(e) => {
              setLabels(e.target.value);
            }}
            placeholder="버그, 디자인, 기능 (쉼표로 구분)"
            maxLength={500}
          />
        </Field>
        <ErrorNotice message={error} />
        {conflict && issue && (
          <div className="conflict-review">
            <p role="status">충돌 · 초안 보존됨</p>
            {!latest ? (
              <button
                type="button"
                className="button secondary"
                disabled={reviewing}
                onClick={() => {
                  void (async () => {
                    setReviewing(true);
                    try {
                      setLatest(
                        (
                          await api(
                            `/issues/${issue.id}`,
                            undefined,
                            issueDetailSchema,
                          )
                        ).issue,
                      );
                    } catch (e) {
                      setError(errorText(e));
                    } finally {
                      setReviewing(false);
                    }
                  })();
                }}
              >
                {reviewing ? "불러오는 중…" : "최신 내용 확인"}
              </button>
            ) : (
              <>
                <strong>서버의 최신 내용 · r{latest.revision}</strong>
                <pre>
                  {JSON.stringify(
                    {
                      제목: latest.title,
                      설명: latest.description,
                      상태: statusNames[latest.status],
                      우선순위: priorityNames[latest.priority],
                      담당자: latest.assignee,
                      목표버전:
                        versions.find((v) => v.id === latest.targetVersionId)
                          ?.name || "없음",
                      발견버전:
                        versions.find((v) => v.id === latest.foundVersionId)
                          ?.name || "없음",
                      수정버전:
                        versions.find((v) => v.id === latest.fixedVersionId)
                          ?.name || "없음",
                      라벨: latest.labels,
                    },
                    null,
                    2,
                  )}
                </pre>
                <p>초안 미저장</p>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setRevision(latest.revision);
                    setConflict(false);
                    setLatest(null);
                    setError("");
                  }}
                >
                  검토 완료 · 초안 유지
                </button>
              </>
            )}
          </div>
        )}
        <footer className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            취소
          </button>
          <button className="button primary" disabled={busy || conflict}>
            {busy ? "저장 중…" : issue ? "변경 저장" : "이슈 만들기"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function Confirm({
  title,
  description,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <div className="editor-form">
        <p className="confirm-description">{description}</p>
        <ErrorNotice message={error} />
        <footer className="form-actions">
          <button className="button secondary" onClick={onClose}>
            취소
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  onClose();
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? "삭제 중…" : "삭제하기"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
