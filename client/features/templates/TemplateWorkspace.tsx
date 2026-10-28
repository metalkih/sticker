import { useState } from "react";
import { z } from "zod";
import type { Bootstrap } from "../../../server/types.js";
import {
  TEMPLATE_EXAMPLES,
  TEMPLATE_FIELDS,
  templateFieldLabels,
  templateDetailSchema,
  templateDefinitionSchema,
  issueTemplateSchema,
  templateAssigneeSchema,
  type TemplateDetail,
  type TemplateDefaults,
} from "../../../server/contracts/templates.js";
import { api, ApiError, json, errorText } from "../../api.js";
import { Field, ErrorNotice } from "../../components.js";
import { statusNames, priorityNames } from "../../format.js";
import { useViewResource } from "../views/useViewResource.js";
import { useDraftGuard } from "./useDraftGuard.js";
const listSchema = issueTemplateSchema.array(),
  assigneesSchema = templateAssigneeSchema.array();
type Definition = z.infer<typeof templateDefinitionSchema>;
const blank: Definition = {
  name: "",
  body: "",
  requiredFields: [],
  defaults: {},
};
function definition(detail: TemplateDetail): Definition {
  return {
    name: detail.template.name,
    body: detail.selectedVersion.body,
    requiredFields: detail.selectedVersion.requiredFields,
    defaults: detail.selectedVersion.defaults,
  };
}
export default function TemplateWorkspace({
  projectId,
  templateId,
  data,
  onSelect,
  onBack,
}: {
  projectId: string;
  templateId: string;
  data: Bootstrap;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const list = useViewResource(
    `/projects/${encodeURIComponent(projectId)}/templates`,
    listSchema,
    !!projectId,
  );
  const detail = useViewResource(
    `/templates/${encodeURIComponent(templateId)}`,
    templateDetailSchema,
    !!templateId && templateId !== "new",
  );
  const directory = useViewResource(
    `/projects/${encodeURIComponent(projectId)}/template-assignees`,
    assigneesSchema,
    !!projectId,
  );
  const scopedDetail =
    detail.value?.template.projectId === projectId ? detail.value : null;
  const [seed, setSeed] = useState<Definition>(blank);
  function create(value: Definition) {
    setSeed(structuredClone(value));
    onSelect("new");
  }
  if (!projectId || !data.projects.some((p) => p.id === projectId))
    return <ErrorNotice message="프로젝트를 찾을 수 없습니다." />;
  return (
    <section className="template-workspace" aria-label="프로젝트 템플릿">
      <div className="template-actions">
        <button className="button secondary" onClick={onBack}>
          프로젝트 목록
        </button>
        {!templateId && (
          <button
            className="button primary"
            onClick={() => {
              create(blank);
            }}
          >
            새 템플릿
          </button>
        )}
      </div>
      {templateId ? (
        <>
          <ErrorNotice
            message={
              detail.error ||
              (detail.value && !scopedDetail
                ? "다른 프로젝트의 템플릿입니다."
                : "")
            }
          />
          {detail.error && (
            <button
              className="button secondary"
              onClick={() => {
                void detail.refresh();
              }}
            >
              템플릿 다시 불러오기
            </button>
          )}
          {templateId === "new" || scopedDetail ? (
            <TemplateForm
              key={templateId}
              initial={
                scopedDetail && templateId !== "new"
                  ? definition(scopedDetail)
                  : seed
              }
              detail={scopedDetail}
              data={data}
              projectId={projectId}
              assignees={directory.value ?? []}
              directoryError={directory.error}
              onRetryDirectory={() => {
                void directory.refresh();
              }}
              onRefresh={detail.refresh}
              onAccept={(next) => {
                detail.accept(
                  next,
                  `/templates/${encodeURIComponent(next.template.id)}`,
                );
                void list.refresh();
              }}
              onSelect={(id) => {
                onSelect(id);
                if (!id) void list.refresh();
              }}
              onDuplicate={create}
            />
          ) : (
            !detail.error &&
            !detail.value && <p role="status">템플릿 불러오는 중…</p>
          )}
        </>
      ) : (
        <>
          <h2>저장된 템플릿</h2>
          <ErrorNotice message={list.error} />
          {list.error && (
            <button
              className="button secondary"
              onClick={() => {
                void list.refresh();
              }}
            >
              목록 다시 불러오기
            </button>
          )}
          {list.loading && !list.value && (
            <p role="status">템플릿 불러오는 중…</p>
          )}
          {list.value?.length === 0 && <p>저장된 템플릿 없음</p>}
          <div className="template-cards">
            {list.value?.map((item) => (
              <article key={item.id}>
                <h3>{item.name}</h3>
                <span>
                  v{item.currentVersion} · r{item.revision}
                </span>
                <button
                  className="button secondary"
                  onClick={() => {
                    onSelect(item.id);
                  }}
                >
                  {item.name} 템플릿 열기
                </button>
              </article>
            ))}
          </div>
          <h2>예시 템플릿</h2>
          <div className="template-cards">
            {TEMPLATE_EXAMPLES.map(({ exampleId, ...example }) => (
              <article key={exampleId}>
                <h3>{example.name}</h3>
                <span>예시</span>
                <ul>
                  {example.requiredFields.map((field) => (
                    <li key={field}>{templateFieldLabels[field]}</li>
                  ))}
                </ul>
                <button
                  className="button secondary"
                  onClick={() => {
                    create(example);
                  }}
                >
                  {example.name} 예시로 만들기
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
function TemplateForm({
  initial,
  detail,
  data,
  projectId,
  assignees,
  directoryError,
  onRetryDirectory,
  onRefresh,
  onAccept,
  onSelect,
  onDuplicate,
}: {
  initial: Definition;
  detail: TemplateDetail | null;
  data: Bootstrap;
  projectId: string;
  assignees: z.infer<typeof templateAssigneeSchema>[];
  directoryError: string;
  onRetryDirectory: () => void;
  onRefresh: () => Promise<void>;
  onAccept: (next: TemplateDetail) => void;
  onSelect: (id: string) => void;
  onDuplicate: (value: Definition) => void;
}) {
  const [draft, setDraft] = useState(initial),
    [baseline, setBaseline] = useState(initial),
    [saved, setSaved] = useState(detail),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [reviewed, setReviewed] = useState<TemplateDetail | null>(null),
    [message, setMessage] = useState(""),
    [history, setHistory] = useState(detail?.template.currentVersion ?? 1);
  const [operationId] = useState(() => crypto.randomUUID());
  const [labelsText, setLabelsText] = useState(
    initial.defaults.labels?.join(", ") ?? "",
  );
  const actualDraft = {
    ...draft,
    defaults: {
      ...draft.defaults,
      ...(labelsText || draft.defaults.labels
        ? {
            labels: labelsText
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          }
        : {}),
    },
  };
  const dirty = JSON.stringify(actualDraft) !== JSON.stringify(baseline),
    guard = useDraftGuard(dirty, busy);
  const latest =
    reviewed && saved && reviewed.template.revision > saved.template.revision
      ? reviewed
      : null;
  const incoming =
    detail && saved && detail.template.revision > saved.template.revision
      ? detail
      : null;
  const versions = data.versions.filter((v) => v.projectId === projectId);
  const selectedHistory = (saved?.versions ?? detail?.versions ?? []).find(
    (v) => v.version === history,
  );
  function setDefault<K extends keyof TemplateDefaults>(
    key: K,
    value: TemplateDefaults[K],
  ) {
    setDraft((prev) => ({
      ...prev,
      defaults: { ...prev.defaults, [key]: value },
    }));
  }
  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || conflict) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const parsed = templateDefinitionSchema.parse(actualDraft);
      const result = await api(
        saved
          ? `/templates/${saved.template.id}`
          : `/projects/${projectId}/templates`,
        {
          method: saved ? "PATCH" : "POST",
          body: json({
            ...parsed,
            ...(saved
              ? { revision: saved.template.revision }
              : { operationId }),
          }),
        },
        templateDetailSchema,
      );
      const next = definition(result);
      setSaved(result);
      setDraft(next);
      setLabelsText(next.defaults.labels?.join(", ") ?? "");
      setBaseline(next);
      setHistory(result.template.currentVersion);
      setReviewed(null);
      setMessage(
        `저장됨 · v${String(result.template.currentVersion)} · r${String(result.template.revision)}`,
      );
      onAccept(result);
      if (!saved)
        guard.proceed(() => {
          onSelect(result.template.id);
        });
      else await onRefresh();
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT" && saved) {
        setConflict(true);
        setReviewed(null);
      }
    } finally {
      setBusy(false);
    }
  }
  async function review() {
    setBusy(true);
    try {
      if (saved) {
        const next = await api(
          `/templates/${saved.template.id}`,
          undefined,
          templateDetailSchema,
        );
        setReviewed(next);
        onAccept(next);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !saved ||
      busy ||
      !window.confirm(
        `“${saved.template.name}” 템플릿을 삭제할까요? 기존 이슈는 유지됩니다.`,
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/templates/${saved.template.id}`, {
        method: "DELETE",
        body: json({ revision: saved.template.revision }),
      });
      guard.proceed(() => {
        onSelect("");
      });
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT")
        setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="editor-form template-form"
      onSubmit={(e) => {
        void save(e);
      }}
    >
      <div className="template-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            guard.leave(() => {
              onSelect("");
            });
          }}
        >
          템플릿 목록
        </button>
        {saved && (
          <>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                guard.leave(() => {
                  onDuplicate({
                    ...actualDraft,
                    name: `${actualDraft.name} 복사`.slice(0, 120),
                  });
                });
              }}
            >
              템플릿 복제
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => {
                void remove();
              }}
            >
              템플릿 삭제
            </button>
          </>
        )}
      </div>
      <h2>
        {saved
          ? `${saved.template.name} · v${String(saved.template.currentVersion)}`
          : "새 템플릿"}
      </h2>
      {message && <p role="status">{message}</p>}
      {dirty && <span>초안 미저장</span>}
      {incoming && !conflict && (
        <p role="status">
          새 버전 · v{incoming.template.currentVersion} · r
          {incoming.template.revision}
        </p>
      )}
      <fieldset disabled={busy}>
        <Field label="템플릿 이름">
          <input
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => {
              setDraft({ ...draft, name: e.target.value });
            }}
          />
        </Field>
        <Field label="템플릿 본문">
          <textarea
            maxLength={20000}
            rows={6}
            value={draft.body}
            onChange={(e) => {
              setDraft({ ...draft, body: e.target.value });
            }}
          />
        </Field>
        <fieldset className="template-required">
          <legend>필수 항목</legend>
          {TEMPLATE_FIELDS.map((field) => (
            <label key={field}>
              <input
                type="checkbox"
                checked={draft.requiredFields.includes(field)}
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    requiredFields: e.target.checked
                      ? [...draft.requiredFields, field]
                      : draft.requiredFields.filter((v) => v !== field),
                  });
                }}
              />
              {templateFieldLabels[field]}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>기본값</legend>
          <div className="form-grid">
            <Field label="기본 상태">
              <select
                value={draft.defaults.status ?? ""}
                onChange={(e) => {
                  setDefault(
                    "status",
                    e.target.value
                      ? (e.target.value as NonNullable<
                          TemplateDefaults["status"]
                        >)
                      : undefined,
                  );
                }}
              >
                <option value="">이슈 기본값</option>
                {Object.entries(statusNames)
                  .filter(([id]) => id !== "closed")
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="기본 우선순위">
              <select
                value={draft.defaults.priority ?? ""}
                onChange={(e) => {
                  setDefault(
                    "priority",
                    e.target.value
                      ? (e.target.value as NonNullable<
                          TemplateDefaults["priority"]
                        >)
                      : undefined,
                  );
                }}
              >
                <option value="">이슈 기본값</option>
                {Object.entries(priorityNames).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="기본 담당자">
              <select
                value={draft.defaults.assignee ?? ""}
                onChange={(e) => {
                  setDefault("assignee", e.target.value);
                }}
              >
                <option value="">미지정</option>
                {draft.defaults.assignee &&
                  !assignees.some((a) => a.id === draft.defaults.assignee) && (
                    <option value={draft.defaults.assignee}>
                      사용 불가 · {draft.defaults.assignee}
                    </option>
                  )}
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.role === "owner" ? "소유자" : "에이전트"}
                  </option>
                ))}
              </select>
            </Field>
            {(
              ["targetVersionId", "foundVersionId", "fixedVersionId"] as const
            ).map((key, index) => (
              <Field
                key={key}
                label={`기본 ${["목표", "발견", "수정"][index]} 버전`}
              >
                <select
                  value={draft.defaults[key] ?? ""}
                  onChange={(e) => {
                    setDefault(key, e.target.value || null);
                  }}
                >
                  <option value="">미지정</option>
                  {draft.defaults[key] &&
                    !versions.some((v) => v.id === draft.defaults[key]) && (
                      <option value={draft.defaults[key] ?? ""}>
                        사용 불가 · {draft.defaults[key]}
                      </option>
                    )}
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <Field label="기본 라벨">
            <input
              maxLength={800}
              value={labelsText}
              onChange={(e) => {
                setLabelsText(e.target.value);
              }}
            />
          </Field>
          <ErrorNotice message={directoryError} />
          {directoryError && (
            <button type="button" onClick={onRetryDirectory}>
              담당자 다시 불러오기
            </button>
          )}
        </fieldset>
      </fieldset>
      <section aria-label="템플릿 미리보기">
        <h3>미리보기</h3>
        <pre>{draft.body || "본문 없음"}</pre>
        <ul>
          {draft.requiredFields.map((field) => (
            <li key={field}>{templateFieldLabels[field]} *</li>
          ))}
        </ul>
        <DefaultPreview
          defaults={actualDraft.defaults}
          data={data}
          assignees={assignees}
        />
      </section>
      <ErrorNotice message={error} />
      {conflict && (
        <div className="template-conflict">
          <p role="status">충돌 · 초안 보존됨</p>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              void review();
            }}
          >
            최신 템플릿 확인
          </button>
          {latest && (
            <>
              <strong>
                {latest.template.name} · v{latest.template.currentVersion} · r
                {latest.template.revision}
              </strong>
              <pre>{latest.selectedVersion.body}</pre>
              <ul>
                {latest.selectedVersion.requiredFields.map((field) => (
                  <li key={field}>{templateFieldLabels[field]} *</li>
                ))}
              </ul>
              <DefaultPreview
                defaults={latest.selectedVersion.defaults}
                data={data}
                assignees={assignees}
              />
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setSaved(latest);
                  setBaseline(definition(latest));
                  setConflict(false);
                  setError("");
                  setReviewed(null);
                }}
              >
                최신 버전 기준으로 초안 유지
              </button>
            </>
          )}
        </div>
      )}
      {saved && (
        <section>
          <Field label="템플릿 버전 기록">
            <select
              value={history}
              onChange={(e) => {
                setHistory(Number(e.target.value));
              }}
            >
              {saved.versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version} · {v.authorName} · {v.createdAt}
                </option>
              ))}
            </select>
          </Field>
          <section aria-label="저장된 버전 미리보기">
            <pre>{selectedHistory?.body}</pre>
            <ul>
              {selectedHistory?.requiredFields.map((field) => (
                <li key={field}>{templateFieldLabels[field]} *</li>
              ))}
            </ul>
            {selectedHistory && (
              <DefaultPreview
                defaults={selectedHistory.defaults}
                data={data}
                assignees={assignees}
              />
            )}
          </section>
        </section>
      )}
      <footer className="form-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            guard.leave(() => {
              onSelect("");
            });
          }}
        >
          취소
        </button>
        <button className="button primary" disabled={busy || conflict}>
          {busy ? "저장 중…" : "템플릿 저장"}
        </button>
      </footer>
    </form>
  );
}

function DefaultPreview({
  defaults,
  data,
  assignees,
}: {
  defaults: TemplateDefaults;
  data: Bootstrap;
  assignees: z.infer<typeof templateAssigneeSchema>[];
}) {
  const entries: [string, string][] = [];
  if (defaults.status) entries.push(["상태", statusNames[defaults.status]]);
  if (defaults.priority)
    entries.push(["우선순위", priorityNames[defaults.priority]]);
  if (defaults.assignee)
    entries.push([
      "담당자",
      assignees.find((a) => a.id === defaults.assignee)?.name ??
        `사용 불가 · ${defaults.assignee}`,
    ]);
  for (const [key, label] of [
    ["targetVersionId", "목표 버전"],
    ["foundVersionId", "발견 버전"],
    ["fixedVersionId", "수정 버전"],
  ] as const) {
    const id = defaults[key];
    if (id)
      entries.push([
        label,
        data.versions.find((v) => v.id === id)?.name ?? `사용 불가 · ${id}`,
      ]);
  }
  if (defaults.labels?.length)
    entries.push(["라벨", defaults.labels.join(", ")]);
  return entries.length ? (
    <dl className="template-default-preview">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  ) : (
    <span>기본 속성 없음</span>
  );
}
