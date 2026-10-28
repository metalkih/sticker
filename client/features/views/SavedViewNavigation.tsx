import React, { useState, useRef, useId } from "react";
import {
  savedViewSchema,
  viewPreferencesSchema,
  type ViewPreferences,
} from "../../../server/contracts/views.js";
import { useViewResource } from "./useViewResource.js";
import { api, json, errorText } from "../../api.js";
const listSchema = savedViewSchema.array();
export function SavedViewNavigation({
  projectId,
  selectedId,
  refreshToken,
  onSelect,
  onChanged,
}: {
  projectId: string;
  selectedId: string;
  refreshToken: unknown;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const closeMenu = () => {
    setExpanded(false);
    toggle.current?.focus();
  };
  const list = useViewResource(
    `/views?projectId=${encodeURIComponent(projectId)}`,
    listSchema,
    !!projectId,
    refreshToken,
  );
  const prefs = useViewResource(
    `/view-preferences/${projectId}`,
    viewPreferencesSchema,
    !!projectId,
    refreshToken,
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function change(
    next: Pick<ViewPreferences, "favoriteIds" | "defaultViewId">,
  ) {
    if (!prefs.value || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/view-preferences/${projectId}`,
        {
          method: "PUT",
          body: json({ ...next, revision: prefs.value.revision }),
        },
        viewPreferencesSchema,
      );
      await prefs.refresh();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!projectId) return null;
  const favorites = prefs.value?.favoriteIds ?? [];
  const views = [...(list.value ?? [])].sort((a, b) => {
    const ai = favorites.indexOf(a.id),
      bi = favorites.indexOf(b.id);
    return (
      (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.name.localeCompare(b.name)
    );
  });
  return (
    <nav
      className="saved-view-navigation"
      aria-label="저장한 뷰"
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
        }
      }}
    >
      <h3 className="saved-view-desktop-title">저장한 뷰</h3>
      <button
        className="saved-view-mobile-toggle"
        ref={toggle}
        aria-expanded={expanded}
        aria-controls={menuId}
        onClick={() => {
          setExpanded((value) => !value);
        }}
      >
        저장한 뷰 {expanded ? "접기" : "펼치기"}
      </button>
      <div
        id={menuId}
        className={`saved-view-menu ${expanded ? "expanded" : ""}`}
      >
        {(list.error || prefs.error || error) && (
          <div role="alert">
            {error || list.error || prefs.error}
            <button
              onClick={() => {
                void list.refresh();
                void prefs.refresh();
              }}
            >
              다시 불러오기
            </button>
          </div>
        )}
        {list.loading && !list.value && <span role="status">불러오는 중</span>}
        {list.value?.length === 0 && <span>저장한 뷰 없음</span>}
        {views.map((v) => (
          <div key={v.id} className="saved-view-row">
            <button
              aria-current={selectedId === v.id ? "page" : undefined}
              onClick={() => {
                onSelect(v.id);
                if (expanded) closeMenu();
              }}
            >
              {v.name}
              {prefs.value?.defaultViewId === v.id ? " · 기본" : ""}
            </button>
            <button
              disabled={busy || !prefs.value}
              aria-label={`${v.name} 즐겨찾기`}
              aria-pressed={favorites.includes(v.id)}
              onClick={() => {
                void change({
                  defaultViewId: prefs.value?.defaultViewId ?? null,
                  favoriteIds: favorites.includes(v.id)
                    ? favorites.filter((id) => id !== v.id)
                    : [...favorites, v.id],
                });
              }}
            >
              {favorites.includes(v.id) ? "★" : "☆"}
            </button>
            {favorites.includes(v.id) && (
              <>
                <button
                  aria-label={`${v.name} 위로`}
                  disabled={busy || favorites.indexOf(v.id) === 0}
                  onClick={() => {
                    const ids = [...favorites],
                      i = ids.indexOf(v.id);
                    [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                    void change({
                      defaultViewId: prefs.value?.defaultViewId ?? null,
                      favoriteIds: ids,
                    });
                  }}
                >
                  ↑
                </button>
                <button
                  aria-label={`${v.name} 아래로`}
                  disabled={
                    busy || favorites.indexOf(v.id) === favorites.length - 1
                  }
                  onClick={() => {
                    const ids = [...favorites],
                      i = ids.indexOf(v.id);
                    [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
                    void change({
                      defaultViewId: prefs.value?.defaultViewId ?? null,
                      favoriteIds: ids,
                    });
                  }}
                >
                  ↓
                </button>
              </>
            )}
          </div>
        ))}
        <label>
          기본 뷰
          <select
            aria-label="기본 뷰"
            disabled={busy || !prefs.value}
            value={prefs.value?.defaultViewId ?? ""}
            onChange={(e) => {
              void change({
                defaultViewId: e.target.value || null,
                favoriteIds: favorites,
              });
            }}
          >
            <option value="">일반 보드</option>
            {views.map((v) => (
              <option value={v.id} key={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </nav>
  );
}
