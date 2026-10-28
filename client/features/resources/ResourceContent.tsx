import React, { useState } from "react";
import type { ResourceVersion } from "../../../server/contracts/resources.js";
import { ErrorNotice } from "../../components.js";
import { SafeMarkdown } from "./SafeMarkdown.js";
import { bytes } from "../../format.js";
export function ResourceContent({ version }: { version: ResourceVersion }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [previewFailed, setPreviewFailed] = useState(false);
  if (version.kind === "markdown")
    return <SafeMarkdown value={version.markdown} />;
  if (version.kind === "link")
    return (
      <a
        className="resource-external-link"
        href={version.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {version.url}
      </a>
    );
  const path = `/api/resources/${version.resourceId}/versions/${String(version.version)}/file`;
  async function download() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, { credentials: "same-origin" });
      if (!response.ok)
        throw new Error(`다운로드 실패 (${String(response.status)})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = version.fileName ?? "download";
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "다운로드 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="resource-file">
      <strong>{version.fileName}</strong>
      <span>
        {bytes(version.size)} · {version.mimeType}
      </span>
      <ErrorNotice message={error} />
      {["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        version.mimeType,
      ) &&
        !previewFailed && (
          <img
            src={`${path}?preview=1`}
            alt={version.fileName}
            onError={() => {
              setPreviewFailed(true);
              setError("미리보기를 불러올 수 없습니다.");
            }}
          />
        )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void download();
        }}
      >
        {busy ? "다운로드 중…" : "파일 다운로드"}
      </button>
    </div>
  );
}
