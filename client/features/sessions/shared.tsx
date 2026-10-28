import type { AgentSession } from "../../../server/contracts/sessions.js";
import { dateText } from "../../format.js";
export function SessionState({
  session,
  time,
}: {
  session: AgentSession;
  time: number;
}) {
  const stale =
    session.stale || time - Date.parse(session.lastReportedAt) > 300000;
  const state = session.closedAt ? "closed" : stale ? "stale" : session.state;
  const label = {
    working: "↗ 작업 중이라는 자기 보고",
    idle: "○ 대기 보고",
    blocked: "! 막힘이라는 자기 보고",
    recorded: "· 기록 수신 (작업 상태 보고 없음)",
    input: "? 입력 필요",
    review: "◇ 결과 검토 필요",
    ended: "✓ 에이전트 종료 보고",
    closed: "■ 소유자 종결",
    stale: "◷ 오래된 자기 보고",
  }[state];
  return (
    <span className={`report-status ${state === "stale" ? "stale" : ""}`}>
      {label}
    </span>
  );
}
export function FetchStamp({
  value,
  failed = false,
}: {
  value: string | null;
  failed?: boolean;
}) {
  return (
    <p className="session-fetch-stamp">
      마지막 확인: {value ? dateText(value, true) : "아직 성공한 조회 없음"}
      {failed && value ? " · 새로고침 실패, 이전 기록입니다." : ""}
    </p>
  );
}
