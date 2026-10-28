import React from "react";
import { resourceReferenceSchema } from "../../../server/contracts/resources.js";
import { useViewResource } from "../views/useViewResource.js";
import { ErrorNotice } from "../../components.js";
import { navigate } from "../../router.js";
import { dateText } from "../../format.js";
const referencesSchema = resourceReferenceSchema.array();
export function SessionResourceReferences({
  sessionId,
}: {
  sessionId: string;
}) {
  const resource = useViewResource(
    `/sessions/${sessionId}/resources`,
    referencesSchema,
  );
  return (
    <section
      className="session-resource-references"
      aria-label="세션 참조 자료"
    >
      <div className="section-heading">
        <h3>
          참조 자료 <span>{resource.value?.length ?? 0}</span>
        </h3>
        <button
          type="button"
          disabled={resource.loading}
          onClick={() => {
            void resource.refresh();
          }}
        >
          참조 새로고침
        </button>
      </div>
      <ErrorNotice message={resource.error} />
      {resource.loading && !resource.value && (
        <div role="status">참조 불러오는 중…</div>
      )}
      {resource.value?.length === 0 && <p>참조 기록 없음</p>}
      {resource.value?.map((item) => (
        <article className="resource-pinned-card" key={item.id}>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              navigate({
                section: "resources",
                project: item.resource.projectId,
                resource: item.resource.id,
                resourceVersion: String(item.version.version),
                session: "",
                issue: "",
              });
            }}
          >
            {item.version.title}
          </button>
          <span>참조 버전 {item.version.version}</span>
          <span>결과 {item.eventId}</span>
          <span>
            기록자 {item.recordedBy} · {dateText(item.createdAt, true)}
          </span>
          {item.resource.deletedAt && <span>원본 삭제됨 · 참조 버전 유지</span>}
        </article>
      ))}
    </section>
  );
}
