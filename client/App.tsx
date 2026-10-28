import { bootstrapSchema } from "../server/response-schemas.js";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Bootstrap,
  Issue,
  Project,
  Status,
  Version,
} from "../server/types.js";
import { STATUSES } from "../server/types.js";
import { api, ApiError, json, errorText } from "./api.js";
import { Icon, Empty, ErrorNotice, StatusPill } from "./components.js";
import {
  ProjectEditor,
  VersionEditor,
  IssueEditor,
  Confirm,
} from "./editors.js";
import IssuePanel from "./IssuePanel.js";
import {
  statusNames,
  statusIcons,
  priorityIcons,
  priorityNames,
  versionStateNames,
  dateText,
} from "./format.js";
type Route = { section: string; project: string; issue: string };
const readRoute = (): Route => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return {
    section: params.get("section") || "issues",
    project: params.get("project") || "",
    issue: params.get("issue") || "",
  };
};
function navigate(next: Partial<Route>) {
  const old = readRoute();
  const params = new URLSearchParams();
  Object.entries({ ...old, ...next }).forEach(([key, value]) => {
    if (value && !(key === "section" && value === "issues"))
      params.set(key, value);
  });
  window.location.hash = params.toString();
}
export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState("");
  const [route, setRoute] = useState<Route>(readRoute);
  const [mode, setMode] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [versionFilter, setVersionFilter] = useState("");
  const [projectEditor, setProjectEditor] = useState<Project | "new" | null>(
    null,
  );
  const [versionEditor, setVersionEditor] = useState<Version | "new" | null>(
    null,
  );
  const [issueEditor, setIssueEditor] = useState<Status | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "project" | "version";
    id: string;
    name: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [reportTime, setReportTime] = useState(Date.now);
  const [filterProject, setFilterProject] = useState(route.project);
  const refreshSequence = useRef(0);
  const refresh = useCallback(() => {
    const sequence = ++refreshSequence.current;
    return api("/bootstrap", undefined, bootstrapSchema)
      .then(
        (next) => {
          if (sequence !== refreshSequence.current) return;
          setData(next);
          setAuthenticated(true);
          setError("");
        },
        (e: unknown) => {
          if (sequence !== refreshSequence.current) return;
          if (e instanceof ApiError && e.status === 401) {
            setAuthenticated(false);
            setData(null);
          } else setError(errorText(e));
        },
      )
      .finally(() => {
        if (sequence !== refreshSequence.current) return;
        setReportTime(Date.now());
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    const requests = refreshSequence;
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => {
      clearInterval(timer);
      requests.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const update = () => {
      setRoute(readRoute());
    };
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("hashchange", update);
    };
  }, []);
  if (filterProject !== route.project) {
    setFilterProject(route.project);
    setStatus("");
    setPriority("");
    setAssignee("");
    setVersionFilter("");
    setSearch("");
  }

  useEffect(() => {
    if (
      data &&
      route.project &&
      !data.projects.some((p) => p.id === route.project)
    )
      navigate({ project: "" });
  }, [data, route.project]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const tag =
        event.target instanceof HTMLElement ? event.target.tagName : "";
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(tag) &&
        !document.querySelector("[role=dialog]")
      ) {
        const search = document.querySelector<HTMLInputElement>(
          '[aria-label="이슈 검색"]',
        );
        if (search) {
          event.preventDefault();
          search.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => {
      setNotice("");
    }, 3500);
    return () => {
      clearTimeout(timeout);
    };
  }, [notice]);
  const closeIssue = useCallback(() => {
    navigate({ issue: "" });
  }, []);
  const project = data?.projects.find((p) => p.id === route.project);
  const projectIssues = useMemo(
    () =>
      data?.issues.filter(
        (i) => !route.project || i.projectId === route.project,
      ) || [],
    [data, route.project],
  );
  const filtered = useMemo(
    () =>
      projectIssues.filter(
        (i) =>
          (!search ||
            `${i.key} ${i.title} ${i.description} ${i.labels.join(" ")}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (!status || i.status === status) &&
          (!priority || i.priority === priority) &&
          (!assignee || i.assignee === assignee) &&
          (!versionFilter || i.targetVersionId === versionFilter),
      ),
    [projectIssues, search, status, priority, assignee, versionFilter],
  );
  const currentVersions =
    data?.versions.filter(
      (v) => !route.project || v.projectId === route.project,
    ) || [];
  const newIssue = () => {
    if (!data?.projects.length) {
      setProjectEditor("new");
      setNotice("먼저 첫 프로젝트를 만들어 주세요.");
    } else setIssueEditor("backlog");
  };
  const newVersion = () => {
    if (!data?.projects.length) {
      setProjectEditor("new");
      setNotice("먼저 첫 프로젝트를 만들어 주세요.");
    } else setVersionEditor("new");
  };
  async function logout() {
    try {
      await api("/session", { method: "DELETE" });
      refreshSequence.current++;
      setAuthenticated(false);
      setData(null);
      navigate({ section: "issues", project: "", issue: "" });
    } catch (e) {
      setError(errorText(e));
    }
  }
  if (loading)
    return (
      <div className="loading-screen">
        <Logo />
        <p>작업 공간을 펼치는 중…</p>
      </div>
    );
  if (!authenticated) return <Login onLogin={refresh} error={error} />;
  if (!data)
    return (
      <div className="loading-screen">
        <ErrorNotice message={error} />
        <button className="button primary" onClick={() => void refresh()}>
          다시 시도
        </button>
      </div>
    );
  const counts = {
    active: projectIssues.filter((i) => !["done", "closed"].includes(i.status))
      .length,
    done: projectIssues.filter((i) => i.status === "done").length,
    waiting: projectIssues.filter((i) => i.status === "waiting").length,
  };
  const heading =
    route.section === "projects"
      ? "프로젝트"
      : route.section === "versions"
        ? "버전과 릴리스"
        : route.section === "agents"
          ? "에이전트 기록"
          : project?.name || "내 작업 공간";
  return (
    <div className="app-shell">
      <aside
        className="sidebar"
        inert={
          !!(
            route.issue ||
            projectEditor ||
            versionEditor ||
            issueEditor ||
            deleteTarget
          )
        }
      >
        <a className="brand" href="#" aria-label="스티커 홈">
          <Logo />
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">나</span>
          <div>
            <strong>나의 스티커</strong>
            <span>개인 작업 공간</span>
          </div>
          <Icon name="lock" size={13} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="작업 공간 메뉴">
          <button
            className={
              route.section === "issues" && !route.project ? "active" : ""
            }
            onClick={() => {
              navigate({ section: "issues", project: "", issue: "" });
            }}
          >
            <Icon name="grid" />
            <span>내 작업 공간</span>
            <small>{data.issues.length}</small>
          </button>
          <button
            className={route.section === "projects" ? "active" : ""}
            onClick={() => {
              navigate({ section: "projects", project: "", issue: "" });
            }}
          >
            <Icon name="folder" />
            <span>프로젝트</span>
          </button>
          <button
            className={route.section === "versions" ? "active" : ""}
            onClick={() => {
              navigate({ section: "versions", issue: "" });
            }}
          >
            <Icon name="version" />
            <span>버전과 릴리스</span>
          </button>
          <button
            className={route.section === "agents" ? "active" : ""}
            onClick={() => {
              navigate({ section: "agents", issue: "" });
            }}
          >
            <Icon name="agent" />
            <span>에이전트 기록</span>
          </button>
        </nav>
        <div className="project-nav-header">
          <span className="nav-label">MY PROJECTS</span>
          <button
            className="icon-button"
            aria-label="새 프로젝트"
            onClick={() => {
              setProjectEditor("new");
            }}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
        <nav className="project-nav" aria-label="프로젝트 목록">
          {data.projects.map((p) => (
            <button
              className={route.project === p.id ? "active" : ""}
              key={p.id}
              onClick={() => {
                navigate({ section: "issues", project: p.id, issue: "" });
              }}
            >
              <span className="project-dot" style={{ background: p.color }} />
              <span>{p.name}</span>
              <small>
                {
                  data.issues.filter(
                    (i) => i.projectId === p.id && i.status !== "closed",
                  ).length
                }
              </small>
            </button>
          ))}
          {!data.projects.length && (
            <span className="sidebar-empty">아직 붙인 프로젝트가 없어요.</span>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="mcp-note">
            <span className="mcp-symbol">↗</span>
            <strong>같은 맥락, 함께 만드는 일.</strong>
            <p>
              MCP로 코딩 에이전트와
              <br />
              이슈와 자료를 연결하세요.
            </p>
            <span className="mcp-tag">
              <span /> MCP READY
            </span>
          </div>
          <button className="account-button" onClick={() => void logout()}>
            <span className="avatar small">나</span>
            <span>
              {data.actor.name}
              <small>소유자 · 비공개</small>
            </span>
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>
      <div
        className="main-shell"
        inert={
          !!(
            route.issue ||
            projectEditor ||
            versionEditor ||
            issueEditor ||
            deleteTarget
          )
        }
      >
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-brand">✳</span>
            <span>나의 스티커</span>
            <span>/</span>
            <strong>{heading}</strong>
          </div>
          <div className="topbar-right">
            <span className="private-label">
              <Icon name="lock" size={11} /> PRIVATE
            </span>
            <button
              className="icon-button"
              aria-label="작업 공간 새로고침"
              onClick={() => void refresh()}
            >
              <Icon name="refresh" size={16} />
            </button>
            <span className="avatar small">나</span>
            <button
              className="icon-button mobile-logout"
              aria-label="로그아웃"
              onClick={() => void logout()}
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {route.section === "issues"
                  ? "A LITTLE STICKER. A CLEARER DAY."
                  : route.section === "projects"
                    ? "SMALL IDEAS, BIG PICTURE."
                    : route.section === "versions"
                      ? "ONE RELEASE AT A TIME."
                      : "CONTEXT, NOT GUESSWORK."}
              </div>
              <h1>
                {heading}
                {route.section === "issues" && (
                  <span className="title-spark" aria-hidden="true">
                    ✳
                  </span>
                )}
              </h1>
              <p>
                {route.section === "issues"
                  ? project?.description ||
                    "작은 생각부터 다음 릴리스까지. 해야 할 일을 한눈에 붙여 두세요."
                  : route.section === "projects"
                    ? "각자의 색으로, 하나의 목표를 향해."
                    : route.section === "versions"
                      ? "목표 · 발견 · 수정 버전을 분리해 변경의 맥락을 남기세요."
                      : "마지막으로 전달된 상태와 근거를 확인하세요. 실행을 추측하지 않아요."}
              </p>
            </div>
            <div className="heading-actions">
              {project && route.section === "issues" && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setProjectEditor(project);
                  }}
                  aria-label="프로젝트 편집"
                >
                  <Icon name="edit" size={15} />
                  <span>프로젝트 편집</span>
                </button>
              )}
              <button
                className="button primary"
                onClick={
                  route.section === "projects"
                    ? () => {
                        setProjectEditor("new");
                      }
                    : route.section === "versions"
                      ? newVersion
                      : newIssue
                }
              >
                <Icon name="plus" size={17} />
                {route.section === "projects"
                  ? "새 프로젝트"
                  : route.section === "versions"
                    ? "새 버전"
                    : "새 이슈"}
              </button>
            </div>
          </div>
          <ErrorNotice message={error} />
          {route.section === "issues" && (
            <>
              <div className="summary-strip">
                <div className="summary-card yellow">
                  <div>
                    <span>지금 움직이는 일</span>
                    <strong>
                      {counts.active}
                      <small>개의 스티커</small>
                    </strong>
                  </div>
                  <span className="summary-doodle" aria-hidden="true">
                    ↗
                  </span>
                  <span className="peel" />
                </div>
                <div className="summary-card lilac">
                  <div>
                    <span>구현 완료 · 검토할 일</span>
                    <strong>
                      {counts.done}
                      <small>소유자 확인 전</small>
                    </strong>
                  </div>
                  <span className="summary-doodle circle" aria-hidden="true">
                    ✓
                  </span>
                  <span className="peel" />
                </div>
                <div className="summary-card peach">
                  <div>
                    <span>승인을 기다리는 일</span>
                    <strong>
                      {counts.waiting}
                      <small>자동 실행하지 않아요</small>
                    </strong>
                  </div>
                  <span className="summary-doodle" aria-hidden="true">
                    Ⅱ
                  </span>
                  <span className="peel" />
                </div>
              </div>
              <div className="issues-section">
                <div className="issues-toolbar">
                  <div className="section-title">
                    <h2>붙여 둔 이슈</h2>
                    <span>{filtered.length}</span>
                  </div>
                  <div className="view-switch" aria-label="보기 방식">
                    <button
                      className={mode === "board" ? "active" : ""}
                      aria-pressed={mode === "board"}
                      onClick={() => {
                        setMode("board");
                      }}
                    >
                      <Icon name="board" size={15} />
                      보드
                    </button>
                    <button
                      className={mode === "list" ? "active" : ""}
                      aria-pressed={mode === "list"}
                      onClick={() => {
                        setMode("list");
                      }}
                    >
                      <Icon name="list" size={15} />
                      리스트
                    </button>
                  </div>
                </div>
                <div className="filters">
                  <label className="search-field">
                    <Icon name="search" size={16} />
                    <input
                      aria-label="이슈 검색"
                      placeholder="이슈 검색…"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                      }}
                    />
                    <kbd>/</kbd>
                  </label>
                  <select
                    aria-label="상태 필터"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                    }}
                  >
                    <option value="">모든 상태</option>
                    {STATUSES.map((s) => (
                      <option value={s} key={s}>
                        {statusNames[s]}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="우선순위 필터"
                    value={priority}
                    onChange={(e) => {
                      setPriority(e.target.value);
                    }}
                  >
                    <option value="">우선순위</option>
                    {Object.entries(priorityNames).map(([v, n]) => (
                      <option value={v} key={v}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="담당자 필터"
                    value={assignee}
                    onChange={(e) => {
                      setAssignee(e.target.value);
                    }}
                  >
                    <option value="">모든 담당자</option>
                    {Array.from(
                      new Set(
                        projectIssues.map((i) => i.assignee).filter(Boolean),
                      ),
                    ).map((a) => (
                      <option value={a} key={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  {currentVersions.length > 0 && (
                    <select
                      aria-label="목표 버전 필터"
                      value={versionFilter}
                      onChange={(e) => {
                        setVersionFilter(e.target.value);
                      }}
                    >
                      <option value="">모든 목표 버전</option>
                      {currentVersions.map((v) => (
                        <option value={v.id} key={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {(search ||
                    status ||
                    priority ||
                    assignee ||
                    versionFilter) && (
                    <button
                      className="text-button clear-filters"
                      onClick={() => {
                        setSearch("");
                        setStatus("");
                        setPriority("");
                        setAssignee("");
                        setVersionFilter("");
                      }}
                    >
                      초기화
                    </button>
                  )}
                </div>
                {!data.projects.length ? (
                  <Empty
                    title="첫 번째 스티커를 붙여 볼까요?"
                    description="프로젝트를 만들고, 해야 할 일과 참고 자료를 한곳에 모아 보세요."
                    action={
                      <button
                        className="button primary"
                        onClick={() => {
                          setProjectEditor("new");
                        }}
                      >
                        <Icon name="plus" size={16} />첫 프로젝트 만들기
                      </button>
                    }
                  />
                ) : !projectIssues.length ? (
                  <Empty
                    title="새로운 가능성을 위한 빈자리"
                    description="첫 이슈를 붙이면 작업의 흐름이 시작돼요."
                    action={
                      <button className="button primary" onClick={newIssue}>
                        <Icon name="plus" size={16} />첫 이슈 만들기
                      </button>
                    }
                  />
                ) : !filtered.length ? (
                  <Empty
                    title="맞는 스티커가 없어요"
                    description="검색어 또는 필터를 바꿔 다시 찾아 보세요."
                  />
                ) : mode === "board" ? (
                  <div className="board">
                    {STATUSES.filter((s) => !status || s === status).map(
                      (s) => (
                        <section className={`board-column column-${s}`} key={s}>
                          <header>
                            <div>
                              <span className={`column-icon status-${s}`}>
                                {statusIcons[s]}
                              </span>
                              <h3>{statusNames[s]}</h3>
                              <span className="count">
                                {filtered.filter((i) => i.status === s).length}
                              </span>
                            </div>
                            <button
                              className="icon-button"
                              aria-label={`${statusNames[s]} 이슈 추가`}
                              onClick={() => {
                                setIssueEditor(s);
                              }}
                            >
                              <Icon name="plus" size={15} />
                            </button>
                          </header>
                          <div className="column-body">
                            {filtered
                              .filter((i) => i.status === s)
                              .map((i) => (
                                <IssueCard
                                  key={i.id}
                                  issue={i}
                                  data={data}
                                  onOpen={() => {
                                    navigate({ issue: i.id });
                                  }}
                                />
                              ))}
                            {!filtered.some((i) => i.status === s) && (
                              <div className="column-empty">
                                아직 붙인 이슈가 없어요
                              </div>
                            )}
                          </div>
                        </section>
                      ),
                    )}
                  </div>
                ) : (
                  <div className="issue-list">
                    <div className="list-table-head">
                      <span>이슈</span>
                      <span>상태</span>
                      <span>담당자</span>
                      <span>목표 버전</span>
                    </div>
                    {filtered.map((i) => (
                      <button
                        className="issue-list-row"
                        key={i.id}
                        onClick={() => {
                          navigate({ issue: i.id });
                        }}
                      >
                        <span className="list-issue-title">
                          <span
                            className={`priority-icon priority-${i.priority}`}
                            title={priorityNames[i.priority]}
                          >
                            {priorityIcons[i.priority]}
                          </span>
                          <span className="issue-key">{i.key}</span>
                          <strong>{i.title}</strong>
                        </span>
                        <StatusPill status={i.status} />
                        <span className="list-assignee">
                          {i.assignee || "미지정"}
                        </span>
                        <span className="list-version">
                          {data.versions.find((v) => v.id === i.targetVersionId)
                            ?.name || "—"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="workspace-footnote">
                <span>
                  <Icon name="lock" size={12} /> 나와 연결한 에이전트만 보는
                  공간
                </span>
                <span>작게 붙이고, 선명하게 끝내요.</span>
              </div>
            </>
          )}
          {route.section === "projects" && (
            <div className="projects-grid">
              {data.projects.map((p) => {
                const issues = data.issues.filter((i) => i.projectId === p.id);
                const complete = issues.filter(
                  (i) => i.status === "closed",
                ).length;
                return (
                  <article className="project-card" key={p.id}>
                    <div className="project-card-top">
                      <span
                        className="project-symbol"
                        style={{ background: p.color }}
                      >
                        {p.key.slice(0, 2)}
                      </span>
                      <span className="project-key">{p.key}</span>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`${p.name} 편집`}
                          onClick={() => {
                            setProjectEditor(p);
                          }}
                        >
                          <Icon name="edit" size={16} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`${p.name} 삭제`}
                          onClick={() => {
                            setDeleteTarget({
                              type: "project",
                              id: p.id,
                              name: p.name,
                            });
                          }}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </div>
                    <button
                      className="project-card-link"
                      onClick={() => {
                        navigate({ section: "issues", project: p.id });
                      }}
                    >
                      <h2>{p.name}</h2>
                      <p>{p.description || "아직 설명이 없는 프로젝트예요."}</p>
                    </button>
                    <div className="project-progress">
                      <div>
                        <span>소유자 종료</span>
                        <strong>
                          {complete} / {issues.length}
                        </strong>
                      </div>
                      <span className="progress-track">
                        <span
                          style={{
                            width: `${String(issues.length ? (complete / issues.length) * 100 : 0)}%`,
                            background: p.color,
                          }}
                        />
                      </span>
                    </div>
                    <footer>
                      <span>
                        {
                          data.versions.filter((v) => v.projectId === p.id)
                            .length
                        }
                        개 버전 · {issues.length}개 이슈
                      </span>
                      <button
                        className="text-button"
                        onClick={() => {
                          navigate({ section: "issues", project: p.id });
                        }}
                      >
                        열기 <Icon name="arrow" size={15} />
                      </button>
                    </footer>
                  </article>
                );
              })}
              <button
                className="new-project-card"
                onClick={() => {
                  setProjectEditor("new");
                }}
              >
                <span>
                  <Icon name="plus" size={26} />
                </span>
                <strong>새 프로젝트 붙이기</strong>
                <small>새로운 아이디어를 위한 자리</small>
              </button>
            </div>
          )}
          {route.section === "versions" && (
            <>
              <div className="section-filter">
                <label>
                  프로젝트
                  <select
                    aria-label="버전 프로젝트 필터"
                    value={route.project}
                    onChange={(e) => {
                      navigate({ project: e.target.value });
                    }}
                  >
                    <option value="">모든 프로젝트</option>
                    {data.projects.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p>버전을 삭제하면 이슈의 해당 버전 연결이 해제돼요.</p>
              </div>
              {currentVersions.length ? (
                <div className="versions-list">
                  {currentVersions.map((v) => {
                    const p = data.projects.find((p) => p.id === v.projectId);
                    const issues = data.issues.filter(
                      (i) => i.targetVersionId === v.id,
                    );
                    return (
                      <article className="version-card" key={v.id}>
                        <div className={`version-sticker ${v.state}`}>
                          <Icon name="version" size={24} />
                        </div>
                        <div className="version-main">
                          <div className="version-title">
                            <h2>{v.name}</h2>
                            <span className={`version-state state-${v.state}`}>
                              {versionStateNames[v.state]}
                            </span>
                          </div>
                          <p>
                            {v.description ||
                              "버전 설명을 추가해 릴리스 범위를 정해 보세요."}
                          </p>
                          <div className="version-meta">
                            <span>
                              <i
                                className="project-dot"
                                style={{ background: p?.color }}
                              />
                              {p?.name}
                            </span>
                            <span>{dateText(v.dueDate)}</span>
                            <span>목표 이슈 {issues.length}개</span>
                          </div>
                        </div>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            aria-label={`${v.name} 버전 편집`}
                            onClick={() => {
                              setVersionEditor(v);
                            }}
                          >
                            <Icon name="edit" size={17} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`${v.name} 버전 삭제`}
                            onClick={() => {
                              setDeleteTarget({
                                type: "version",
                                id: v.id,
                                name: v.name,
                              });
                            }}
                          >
                            <Icon name="trash" size={17} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <Empty
                  title="다음 릴리스를 위한 한 장"
                  description="버전을 만들고 목표 이슈를 연결해 보세요. 발견한 버전과 수정한 버전도 별도로 남길 수 있어요."
                  action={
                    <button className="button primary" onClick={newVersion}>
                      첫 버전 만들기
                    </button>
                  }
                />
              )}
            </>
          )}
          {route.section === "agents" && (
            <>
              <div className="agent-disclaimer">
                <Icon name="agent" size={28} />
                <div>
                  <strong>상태 보고는 실행 증명이 아니에요.</strong>
                  <p>
                    에이전트가 MCP로 마지막 전달한 내용이에요. 5분이 지나면
                    오래된 보고로 표시해요. 스티커는 에이전트나 셸을 실행하지
                    않아요.
                  </p>
                </div>
              </div>
              {data.reports.filter(
                (r) => !route.project || r.projectId === route.project,
              ).length ? (
                <div className="agent-grid">
                  {data.reports
                    .filter(
                      (r) => !route.project || r.projectId === route.project,
                    )
                    .map((r) => {
                      const stale =
                        r.stale ||
                        reportTime - new Date(r.reportedAt).getTime() > 300_000;
                      return (
                        <article className="agent-card" key={r.id}>
                          <header>
                            <span className="agent-avatar">
                              <Icon name="agent" size={22} />
                            </span>
                            <div>
                              <h2>{r.agentName}</h2>
                              <span>
                                {
                                  data.projects.find(
                                    (p) => p.id === r.projectId,
                                  )?.name
                                }
                              </span>
                            </div>
                            <span
                              className={`report-status ${stale ? "stale" : ""}`}
                            >
                              {stale ? "오래된 보고" : "최근 자기 보고"}
                            </span>
                          </header>
                          <p>{r.message || "상세 메시지가 없어요."}</p>
                          <div className="agent-state">
                            보고한 상태:{" "}
                            <strong>
                              {
                                {
                                  idle: "대기",
                                  working: "작업 중이라고 보고",
                                  blocked: "막힘",
                                  done: "완료",
                                }[r.state]
                              }
                            </strong>
                          </div>
                          <footer>
                            <time dateTime={r.reportedAt}>
                              {dateText(r.reportedAt, true)}
                            </time>
                            {r.issueId && (
                              <button
                                className="text-button"
                                onClick={() => {
                                  if (r.issueId) navigate({ issue: r.issueId });
                                }}
                              >
                                연결 이슈 <Icon name="arrow" size={14} />
                              </button>
                            )}
                          </footer>
                        </article>
                      );
                    })}
                </div>
              ) : (
                <Empty
                  title="아직 전달된 상태 보고가 없어요"
                  description="MCP를 연결한 에이전트가 상태를 보고하면 이곳에 기록돼요. 연결 방법은 설치 문서의 MCP 항목을 확인하세요."
                />
              )}
            </>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          {notice}
        </div>
      )}
      {projectEditor && (
        <ProjectEditor
          project={projectEditor === "new" ? undefined : projectEditor}
          onClose={() => {
            setProjectEditor(null);
          }}
          onSaved={async (p) => {
            setProjectEditor(null);
            await refresh();
            navigate({ section: "issues", project: p.id });
            setNotice("프로젝트를 저장했어요.");
          }}
        />
      )}
      {versionEditor && (
        <VersionEditor
          version={versionEditor === "new" ? undefined : versionEditor}
          data={data}
          projectId={route.project}
          onClose={() => {
            setVersionEditor(null);
          }}
          onSaved={async () => {
            setVersionEditor(null);
            await refresh();
            setNotice("버전을 저장했어요.");
          }}
        />
      )}
      {issueEditor && (
        <IssueEditor
          initialStatus={issueEditor}
          data={data}
          projectId={route.project}
          onClose={() => {
            setIssueEditor(null);
          }}
          onSaved={async (issue) => {
            setIssueEditor(null);
            await refresh();
            navigate({ issue: issue.id });
            setNotice("스티커를 붙였어요.");
          }}
        />
      )}
      {route.issue && (
        <IssuePanel
          key={route.issue}
          id={route.issue}
          data={data}
          onClose={closeIssue}
          onChanged={refresh}
        />
      )}
      {deleteTarget && (
        <Confirm
          title={`${deleteTarget.name} 삭제`}
          description={
            deleteTarget.type === "project"
              ? "프로젝트에 이슈나 버전이 남아 있으면 삭제할 수 없어요. 빈 프로젝트만 삭제돼요."
              : "이 버전의 모든 이슈 연결이 해제돼요. 이슈 자체는 삭제되지 않아요."
          }
          onClose={() => {
            setDeleteTarget(null);
          }}
          onConfirm={async () => {
            await api(
              `/${deleteTarget.type === "project" ? "projects" : "versions"}/${deleteTarget.id}`,
              { method: "DELETE" },
            );
            if (
              deleteTarget.type === "project" &&
              route.project === deleteTarget.id
            )
              navigate({ project: "" });
            await refresh();
            setNotice("삭제했어요.");
          }}
        />
      )}
    </div>
  );
}
function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark">✳</span>
      <strong>
        스티커<span className="logo-period">.</span>
      </strong>
    </span>
  );
}
function Login({
  onLogin,
  error: outerError,
}: {
  onLogin: () => Promise<void>;
  error: string;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <header>
        <Logo />
        <span>
          <Icon name="lock" size={13} /> YOUR PRIVATE WORKSPACE
        </span>
      </header>
      <main className="login-content">
        <div className="login-story">
          <div className="eyebrow">SMALL NOTES. CLEAR DIRECTION.</div>
          <h1>
            생각을 붙이고,
            <br />
            일을 움직여요.
          </h1>
          <p>
            프로젝트, 이슈, 다음 버전까지.
            <br />
            나와 코딩 에이전트를 위한 작은 작업 공간.
          </p>
          <div className="login-stickers" aria-hidden="true">
            <div className="login-sticker green">
              <span>IDEA → DONE</span>
              <strong>
                한 장씩,
                <br />
                앞으로.
              </strong>
              <i>↗</i>
            </div>
            <div className="login-sticker purple">
              <span>LESS NOISE.</span>
              <strong>
                더 선명한
                <br />
                다음 할 일.
              </strong>
              <i>✳</i>
            </div>
            <span className="login-scribble">붙여 두면, 잊지 않으니까.</span>
          </div>
        </div>
        <section className="login-card">
          <span className="login-card-icon">
            <Icon name="lock" size={25} />
          </span>
          <h2>나의 작업 공간으로</h2>
          <p>설정한 소유자 비밀번호로 들어오세요.</p>
          <form
            onSubmit={(e) => {
              void (async () => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError("");
                try {
                  await api("/session", {
                    method: "POST",
                    body: json({ password }),
                  });
                  await onLogin();
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <label className="field">
              <span>소유자 비밀번호</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
                placeholder="비밀번호를 입력하세요"
              />
            </label>
            <ErrorNotice message={error || outerError} />
            <button className="button primary" disabled={busy}>
              {busy ? "확인하는 중…" : "작업 공간 열기"}
              <Icon name="arrow" size={18} />
            </button>
          </form>
          <div className="login-security">
            <Icon name="lock" size={14} />
            <span>비공개 기본 설정 · 안전한 로컬 저장</span>
          </div>
          <p className="login-setup">
            처음 설치하셨나요?
            <br />
            설치 문서에서 소유자 비밀번호를 먼저 설정해 주세요.
          </p>
        </section>
      </main>
      <footer>STICKER — FOR YOUR NEXT LITTLE BIG THING.</footer>
    </div>
  );
}
function IssueCard({
  issue: i,
  data,
  onOpen,
}: {
  issue: Issue;
  data: Bootstrap;
  onOpen: () => void;
}) {
  const p = data.projects.find((p) => p.id === i.projectId);
  const version = data.versions.find((v) => v.id === i.targetVersionId);
  return (
    <button className={`issue-card card-${i.status}`} onClick={onOpen}>
      <div className="issue-card-top">
        <span className="issue-key">{i.key}</span>
        <span
          className={`priority-icon priority-${i.priority}`}
          title={priorityNames[i.priority]}
        >
          {priorityIcons[i.priority]}
        </span>
      </div>
      <h4>{i.title}</h4>
      {i.labels.length > 0 && (
        <div className="card-labels">
          {i.labels.slice(0, 3).map((l) => (
            <span className="label-tag" key={l}>
              {l}
            </span>
          ))}
          {i.labels.length > 3 && (
            <span className="label-tag">+{i.labels.length - 3}</span>
          )}
        </div>
      )}
      <div className="issue-card-bottom">
        <span className="card-project">
          <i className="project-dot" style={{ background: p?.color }} />
          {version?.name || p?.name}
        </span>
        <span className="card-assignee" title={i.assignee || "미지정"}>
          {i.assignee ? (
            <span className="avatar tiny">{i.assignee.slice(0, 1)}</span>
          ) : (
            <span className="unassigned-avatar">○</span>
          )}
        </span>
      </div>
    </button>
  );
}
