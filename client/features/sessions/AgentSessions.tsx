import type { Bootstrap } from "../../../server/types.js";
import { sessionSchema } from "../../../server/contracts/sessions.js";
import { Empty, ErrorNotice, Icon } from "../../components.js";
import { dateText } from "../../format.js";
import { navigate } from "../../router.js";
import { useResource, useReportClock } from "./useResource.js";
import { FetchStamp, SessionState } from "./shared.js";
import SessionDetail from "./SessionDetail.js";
const sessionsSchema = sessionSchema.array();
export default function AgentSessions({
  data,
  projectId,
  sessionId,
  observedAt,
}: {
  data: Bootstrap;
  projectId: string;
  sessionId: string;
  observedAt: number;
}) {
  const resource = useResource(
      `/sessions${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      sessionsSchema,
    ),
    time = Math.max(useReportClock(), observedAt);
  return (
    <section aria-label="세션 기록">
      <p className="session-source">출처: 에이전트 자기 보고</p>
      <div className="session-toolbar">
        <label>
          프로젝트 필터{" "}
          <select
            aria-label="세션 프로젝트 필터"
            value={projectId}
            onChange={(e) => {
              navigate({ project: e.target.value, session: "" });
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
          disabled={resource.loading}
          onClick={() => void resource.refresh()}
        >
          세션 새로고침
        </button>
      </div>
      <FetchStamp value={resource.lastFetched} failed={!!resource.error} />
      <ErrorNotice message={resource.error} />
      {resource.error && (
        <button className="button" onClick={() => void resource.refresh()}>
          세션 조회 다시 시도
        </button>
      )}
      {resource.loading && !resource.data && (
        <p role="status">세션을 불러오는 중…</p>
      )}
      {resource.data?.length === 0 && (
        <Empty title="아직 전달된 세션이 없어요" />
      )}
      <div className="agent-grid">
        {resource.data?.map((s) => (
          <article className="agent-card session-card" key={s.id}>
            <header>
              <Icon name="agent" />
              <h2>{s.agentName}</h2>
            </header>
            <SessionState session={s} time={time} />
            <p className="session-summary">
              {s.lastMessage || "아직 보고된 메시지가 없어요."}
            </p>
            <p>
              {data.projects.find((p) => p.id === s.projectId)?.name} ·{" "}
              {data.issues.find((i) => i.id === s.issueId)?.key ||
                "연결 이슈 없음"}
            </p>
            <p>
              세션 ID: <code>{s.externalSessionId}</code>
            </p>
            <p>
              시작:{" "}
              <time dateTime={s.startedAt}>{dateText(s.startedAt, true)}</time>
              <br />
              최근 수신:{" "}
              <time dateTime={s.lastReportedAt}>
                {dateText(s.lastReportedAt, true)}
              </time>
            </p>
            <p>
              입력 {s.pendingInput} · 결과 검토 {s.pendingReview}
              {s.legacy ? " · 이전 단일 보고에서 옮김" : ""}
            </p>
            <button
              className="button"
              aria-label={`세션 ${s.externalSessionId} 상세`}
              onClick={() => {
                navigate({ session: s.id });
              }}
            >
              세션 상세 <Icon name="arrow" size={14} />
            </button>
          </article>
        ))}
      </div>
      {sessionId && (
        <SessionDetail
          key={sessionId}
          id={sessionId}
          data={data}
          onClose={() => {
            navigate({ session: "" });
          }}
        />
      )}
    </section>
  );
}
