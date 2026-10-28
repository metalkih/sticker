import React, { useState } from "react";
import type { IssueQuery } from "../../../server/contracts/issue-query.js";
import {
  savedViewSchema,
  type SavedView,
} from "../../../server/contracts/views.js";
import { api, json, errorText } from "../../api.js";
import { Modal, Field, ErrorNotice } from "../../components.js";
export function SavedViewEditor({
  view,
  query,
  duplicate = false,
  onClose,
  onSaved,
}: {
  view?: SavedView | null;
  query: IssueQuery;
  duplicate?: boolean;
  onClose: () => void;
  onSaved: (view: SavedView) => Promise<void>;
}) {
  const [name, setName] = useState(
      view ? `${view.name}${duplicate ? " 복제" : ""}` : "",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        view && !duplicate ? `/views/${view.id}` : "/views",
        {
          method: view && !duplicate ? "PATCH" : "POST",
          body: json({
            name,
            query,
            ...(view && !duplicate ? { revision: view.revision } : {}),
          }),
        },
        savedViewSchema,
      );
      await onSaved(result);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={duplicate ? "뷰 복제" : view ? "뷰 저장" : "새 뷰"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice message={error} />
        <Field label="뷰 이름">
          <input
            required
            maxLength={80}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            취소
          </button>
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy ? "저장 중…" : "뷰 저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
