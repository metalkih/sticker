import type { Version } from "../../../server/types.js";
import {
  templateFieldLabels,
  renderTemplate,
  type TemplateDetail,
  type TemplateValues,
  type TemplateField,
} from "../../../server/contracts/templates.js";
import { Field } from "../../components.js";
export function TemplateIssueFields({
  detail,
  values,
  errors,
  onChange,
  versions,
  body,
}: {
  detail: TemplateDetail;
  values: TemplateValues;
  errors: Record<string, string>;
  onChange: (field: TemplateField, value: string) => void;
  versions: Version[];
  body: string;
}) {
  return (
    <section className="template-issue-fields">
      <h3>
        {detail.template.name} · v{detail.selectedVersion.version}
      </h3>
      {detail.selectedVersion.requiredFields.map((field) => (
        <div key={field}>
          <Field label={`${templateFieldLabels[field]} *`}>
            {field === "foundVersionId" ? (
              <select
                aria-invalid={!!errors[field]}
                aria-describedby={
                  errors[field] ? `template-error-${field}` : undefined
                }
                value={values[field] ?? ""}
                onChange={(e) => {
                  onChange(field, e.target.value);
                }}
              >
                <option value="">지정하지 않음</option>
                {values[field] &&
                  !versions.some((v) => v.id === values[field]) && (
                    <option value={values[field]}>
                      사용 불가 · {values[field]}
                    </option>
                  )}
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : (
              <textarea
                rows={3}
                maxLength={8000}
                aria-invalid={!!errors[field]}
                aria-describedby={
                  errors[field] ? `template-error-${field}` : undefined
                }
                value={values[field] ?? ""}
                onChange={(e) => {
                  onChange(field, e.target.value);
                }}
              />
            )}
          </Field>
          {errors[field] && (
            <p role="alert" id={`template-error-${field}`}>
              {errors[field]}
            </p>
          )}
        </div>
      ))}
      <section aria-label="이슈 미리보기">
        <h3>미리보기 · v{detail.selectedVersion.version}</h3>
        <pre>
          {renderTemplate(
            body,
            values,
            versions.find((v) => v.id === values.foundVersionId)?.name,
          ) || "본문 없음"}
        </pre>
      </section>
    </section>
  );
}
