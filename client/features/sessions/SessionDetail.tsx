import { SessionResourceReferences } from "../resources/SessionResourceReferences.js";
import { createPortal } from "react-dom";
import { useState } from "react";
import type { Bootstrap } from "../../../server/types.js";
import {
  sessionDetailSchema,
  sessionSchema,
} from "../../../server/contracts/sessions.js";
import { api, json, errorText } from "../../api.js";
import { Modal, ErrorNotice, Empty } from "../../components.js";
import { dateText } from "../../format.js";
import { navigate } from "../../router.js";
import { useResource, useReportClock } from "./useResource.js";
import { FetchStamp, SessionState } from "./shared.js";
export default function SessionDetail({
  id,
  data,
  onClose,
}: {
  id: string;
  data: Bootstrap;
  onClose: () => void;
}) {
  const resource = useResource(
      `/sessions/${encodeURIComponent(id)}`,
      sessionDetailSchema,
    ),
    time = useReportClock();
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const detail = resource.data;
  async function closeSession() {
    if (!detail || pending) return;
    setPending(true);
    try {
      await api(
        `/sessions/${encodeURIComponent(id)}/close`,
        {
          method: "POST",
          body: json({
            revision: detail.session.revision,
            operationId: crypto.randomUUID(),
          }),
        },
        sessionSchema,
      );
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
    <Modal title="에이전트 세션 상세" onClose={onClose} wide>
      <div className="session-detail">
        <FetchStamp value={resource.lastFetched} failed={!!resource.error} />
        <ErrorNotice message={error || resource.error} />
        {resource.loading && !detail && (
          <p role="status">세션 상세를 불러오는 중…</p>
        )}
        {resource.code === "SESSION_NOT_FOUND" && (
          <p>세션이 없거나 삭제되었습니다.</p>
        )}
        {resource.code === "PROJECT_SCOPE" && (
          <p>이 세션에 접근할 수 없습니다.</p>
        )}
        {resource.error && (
          <button className="button" onClick={() => void resource.refresh()}>
            상세 조회 다시 시도
          </button>
        )}
        {detail && (
          <>
            <SessionResourceReferences key={id} sessionId={id} />
            <h3>
              {detail.session.agentName} · {detail.session.externalSessionId}
            </h3>
            <p>
              출처: 인증된 에이전트의 자기 보고
              {detail.session.legacy ? " · 이전 단일 보고" : ""}
            </p>
            <SessionState session={detail.session} time={time} />
            {detail.requests.some(
              (request) => request.status === "pending",
            ) && (
              <section className="session-pending" aria-label="미처리 요청">
                <h3>미처리 요청</h3>
                <ul>
                  {detail.requests
                    .filter((request) => request.status === "pending")
                    .map((request) => {
                      const kind =
                        request.kind === "input"
                          ? "입력 요청"
                          : "결과 검토 요청";
                      const characters = Array.from(request.prompt);
                      const preview = characters.slice(0, 40).join("");
                      return (
                        <li key={request.id}>
                          <button
                            className="button secondary session-request-action"
                            aria-label={`${kind} ${request.id} 확인`}
                            aria-describedby={`request-preview-${request.id}`}
                            onClick={() => {
                              navigate({
                                section: "inbox",
                                request: request.id,
                                session: "",
                              });
                            }}
                          >
                            <span className="session-request-kind">
                              {request.kind === "input" ? "?" : "◇"} {kind} 확인{" "}
                              <code>{request.id.slice(0, 8)}</code>
                            </span>
                            <span
                              id={`request-preview-${request.id}`}
                              className="session-request-preview"
                            >
                              {preview}
                              {characters.length > 40 ? "…" : ""}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </section>
            )}

            <p>
              시작: {dateText(detail.session.startedAt, true)}
              <br />
              최근 서버 수신: {dateText(detail.session.lastReportedAt, true)}
              <br />
              에이전트 종료 보고:{" "}
              {detail.session.endedAt
                ? dateText(detail.session.endedAt, true)
                : "없음"}
              <br />
              소유자 종결:{" "}
              {detail.session.closedAt
                ? dateText(detail.session.closedAt, true)
                : "미종결"}
            </p>
            {detail.session.issueId && (
              <button
                className="text-button"
                onClick={() => {
                  navigate({
                    issue: detail.session.issueId ?? "",
                    session: "",
                  });
                }}
              >
                연결 이슈{" "}
                {data.issues.find((i) => i.id === detail.session.issueId)
                  ?.key || "보기"}
              </button>
            )}
            <div className="session-toolbar">
              <h3>이벤트 타임라인</h3>
              <span className="session-fetch-stamp">
                발생 시각 ↑ · 수신 시각 ↑ · eventId ↑
              </span>
            </div>
            {!detail.events.length && (
              <Empty title="아직 보고된 이벤트가 없어요" />
            )}
            <ol className="session-timeline" aria-label="이벤트 타임라인">
              {detail.events.map((e) => (
                <li key={e.eventId}>
                  <h4>
                    {
                      {
                        report: "↗ 자기 보고",
                        request: "? 확인 요청",
                        result: "◇ 결과",
                        error: "! 오류",
                        end: "✓ 에이전트 종료 보고",
                      }[e.kind]
                    }
                  </h4>
                  <p>
                    발생: {dateText(e.occurredAt, true)} · 서버 수신:{" "}
                    {dateText(e.receivedAt, true)}
                  </p>
                  <code>eventId: {e.eventId}</code>
                  <pre>{e.message}</pre>
                  {detail.requests
                    .filter((r) => r.eventId === e.eventId)
                    .map((r) => (
                      <button
                        key={r.id}
                        className="text-button"
                        onClick={() => {
                          navigate({
                            section: "inbox",
                            request: r.id,
                            session: "",
                          });
                        }}
                      >
                        {r.kind === "input" ? "입력 요청" : "결과 검토 요청"} ·{" "}
                        {r.status === "pending" ? "미처리" : "처리 완료"} 확인
                      </button>
                    ))}
                </li>
              ))}
            </ol>
            {data.actor.role === "owner" && !detail.session.closedAt && (
              <button
                className="button"
                disabled={pending}
                onClick={() => void closeSession()}
              >
                세션 기록 종결 (이슈 유지)
              </button>
            )}
          </>
        )}
      </div>
    </Modal>,
    document.body,
  );
}
