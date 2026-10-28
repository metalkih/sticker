import { createPortal } from "react-dom";
import { useRef, useState } from "react";
import type { Bootstrap } from "../../../server/types.js";
import { sessionRequestSchema } from "../../../server/contracts/sessions.js";
import { api, json, errorText } from "../../api.js";
import { Modal, ErrorNotice, Empty, Field } from "../../components.js";
import { dateText } from "../../format.js";
import { navigate } from "../../router.js";
import { useResource } from "./useResource.js";
import { FetchStamp } from "./shared.js";
const requestsSchema = sessionRequestSchema.array();
export default function OwnerInbox({
  data,
  projectId,
  requestId,
}: {
  data: Bootstrap;
  projectId: string;
  requestId: string;
}) {
  const [completed, setCompleted] = useState(false);
  const returnFocus = useRef<HTMLButtonElement>(null);
  const query = new URLSearchParams({ completed: String(completed) });
  if (projectId) query.set("projectId", projectId);
  const resource = useResource(`/inbox?${query.toString()}`, requestsSchema);
  return (
    <section aria-label="사용자 확인함">
      <div className="session-toolbar">
        <label>
          프로젝트 필터{" "}
          <select
            aria-label="확인함 프로젝트 필터"
            value={projectId}
            onChange={(e) => {
              navigate({ project: e.target.value, request: "" });
            }}
          >
            <option value="">모든 프로젝트</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          ref={returnFocus}
          onClick={() => {
            setCompleted((v) => !v);
          }}
        >
          {completed ? "미처리 보기" : "처리 완료 보기"}
        </button>
        <button
          className="button"
          disabled={resource.loading}
          onClick={() => void resource.refresh()}
        >
          확인함 새로고침
        </button>
      </div>
      <FetchStamp value={resource.lastFetched} failed={!!resource.error} />
      <ErrorNotice message={resource.error} />
      {resource.error && (
        <button className="button" onClick={() => void resource.refresh()}>
          확인함 조회 다시 시도
        </button>
      )}
      {resource.loading && !resource.data && (
        <p role="status">확인함을 불러오는 중…</p>
      )}
      {resource.data?.length === 0 && (
        <Empty
          title={completed ? "처리 완료된 요청이 없어요" : "미처리 요청 0건"}
        />
      )}
      {(["input", "review"] as const).map((kind) => (
        <section key={kind} className="inbox-group">
          <h2>{kind === "input" ? "? 입력 필요" : "◇ 결과 검토 필요"}</h2>
          {resource.data
            ?.filter((r) => r.kind === kind)
            .map((r) => (
              <article className="agent-card session-card" key={r.id}>
                <h3>{r.prompt}</h3>
                <p>
                  {data.projects.find((p) => p.id === r.projectId)?.name} ·{" "}
                  {data.issues.find((i) => i.id === r.issueId)?.key ||
                    "연결 이슈 없음"}
                </p>
                <p>
                  {r.agentName} · 세션 {r.externalSessionId}
                  <br />
                  요청: {dateText(r.createdAt, true)}
                </p>
                <p>
                  {r.status === "pending"
                    ? "미처리"
                    : r.status === "answered"
                      ? "처리 완료: 답변 기록됨"
                      : "처리 완료: 소유자 종결"}
                </p>
                <button
                  className="button"
                  aria-label={`요청 ${r.prompt} 확인`}
                  onClick={() => {
                    navigate({ request: r.id });
                  }}
                >
                  요청 확인
                </button>
              </article>
            ))}
        </section>
      ))}
      {requestId && (
        <RequestDetail
          key={requestId}
          id={requestId}
          data={data}
          onClose={() => {
            navigate({ request: "" });
            void resource.refresh();
            setTimeout(() => returnFocus.current?.focus(), 0);
          }}
        />
      )}
    </section>
  );
}
function RequestDetail({
  id,
  data,
  onClose,
}: {
  id: string;
  data: Bootstrap;
  onClose: () => void;
}) {
  const resource = useResource(
    `/requests/${encodeURIComponent(id)}`,
    sessionRequestSchema,
  );
  const [body, setBody] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const operation = useRef<{
    revision: number;
    body: string;
    operationId: string;
  } | null>(null);
  const current = resource.data;
  async function send(close = false) {
    if (!current || pending) return;
    setPending(true);
    try {
      if (close)
        resource.accept(
          await api(
            `/requests/${encodeURIComponent(id)}/close`,
            {
              method: "POST",
              body: json({
                revision: current.revision,
                operationId: crypto.randomUUID(),
              }),
            },
            sessionRequestSchema,
          ),
        );
      else {
        if (
          !operation.current ||
          operation.current.body !== body ||
          operation.current.revision !== current.revision
        )
          operation.current = {
            revision: current.revision,
            body,
            operationId: crypto.randomUUID(),
          };
        resource.accept(
          await api(
            `/requests/${encodeURIComponent(id)}/responses`,
            { method: "POST", body: json(operation.current) },
            sessionRequestSchema,
          ),
        );
      }
      setError("");
      await resource.refresh();
    } catch (error) {
      setError(errorText(error));
      await resource.refresh();
    } finally {
      setPending(false);
    }
  }
  return createPortal(
    <Modal title="요청 확인" onClose={onClose}>
      <div className="session-detail">
        <FetchStamp value={resource.lastFetched} failed={!!resource.error} />
        <ErrorNotice message={error || resource.error} />
        {resource.loading && !current && (
          <p role="status">요청을 불러오는 중…</p>
        )}
        {resource.error && (
          <button className="button" onClick={() => void resource.refresh()}>
            요청 조회 다시 시도
          </button>
        )}
        {current && (
          <>
            <h3>
              {current.kind === "input" ? "? 입력 요청" : "◇ 결과 검토 요청"}
            </h3>
            <pre>{current.prompt}</pre>
            <p>
              요청 ID: <code>{id}</code>
              <br />
              {
                data.projects.find((p) => p.id === current.projectId)?.name
              } ·{" "}
              {data.issues.find((i) => i.id === current.issueId)?.key ||
                "연결 이슈 없음"}
              <br />
              세션: {current.externalSessionId}
              <br />
              요청 시각: {dateText(current.createdAt, true)}
            </p>
            <button
              className="text-button"
              onClick={() => {
                navigate({
                  section: "agents",
                  session: current.sessionId,
                  request: "",
                });
              }}
            >
              세션 이력 보기
            </button>
            {current.issueId && (
              <button
                className="text-button"
                onClick={() => {
                  navigate({ issue: current.issueId ?? "", request: "" });
                }}
              >
                연결 이슈 열기 (별도 종결)
              </button>
            )}
            {current.status !== "pending" && (
              <p role="status">
                {current.status === "answered"
                  ? "처리 완료: 답변 기록됨"
                  : "처리 완료: 소유자 종결"}
              </p>
            )}
            {current.response && (
              <>
                <h4>기록된 답변</h4>
                <pre>{current.response}</pre>
                <p>{dateText(current.respondedAt, true)}</p>
              </>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <Field label="답변">
                <textarea
                  aria-label="답변"
                  maxLength={20000}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                  }}
                  rows={6}
                />
              </Field>

              {data.actor.role === "owner" && (
                <div className="session-toolbar">
                  <button
                    className="button primary"
                    type="submit"
                    disabled={
                      pending || !body.trim() || current.status !== "pending"
                    }
                  >
                    답변 기록
                  </button>
                  {current.status !== "closed" && (
                    <button
                      className="button"
                      type="button"
                      disabled={pending}
                      onClick={() => void send(true)}
                    >
                      요청 검토 종결 (이슈 유지)
                    </button>
                  )}
                </div>
              )}
            </form>
          </>
        )}
      </div>
    </Modal>,
    document.body,
  );
}
