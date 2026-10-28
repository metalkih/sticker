# 프로젝트 이슈 템플릿 (schema 6)

GH #5, #18, #19. 프로젝트의 **템플릿 관리**에서 빈 정의 또는 버그/기능/에이전트 작업 예시로 생성합니다. 예시는 저장된 사용자 템플릿과 분리됩니다. 본문, 고정 필수 항목, 허용 기본 속성의 미리보기·편집·복제·삭제와 작성자/시각별 버전 기록을 제공합니다. 수정은 불변 버전을 추가하며 삭제는 tombstone입니다. 기존 이슈 본문은 바뀌지 않습니다.

## 생성과 검증

새 이슈의 템플릿 선택은 편집 가능한 기본 본문과 상태/우선순위/설정된 담당자/라벨/같은 프로젝트 버전을 채웁니다. 작성 중 교체·프로젝트 변경은 확인하며 취소하면 초안을 유지합니다. 별도 필수 입력을 검증한 뒤 고정 순서의 Markdown 섹션을 본문에 합칩니다. UI·HTTP·MCP는 `server/contracts/templates.ts`의 동일한 필드/검증/렌더러와 `TemplateService.apply`를 사용합니다.

필수 필드는 재현 절차, 기대/실제 결과, 발견 버전, 문제, 범위, 완료 기준, 입력, 제약, 검증의 고정 열거입니다. 임의 필드와 권한·실행 동작은 정의하지 않습니다. 본문 20,000자, 항목별 8,000자와 기존 최종 이슈 설명 50,000자 제한이 적용됩니다. 템플릿이 없으면 기존 자유 본문/담당자 등록을 그대로 사용합니다.

선택한 `templateId`와 **현재** `templateVersion`, `templateValues`, 생성 작업의 UUID `operationId`를 일반 `POST /api/issues`에 전달합니다. `description`은 편집한 기본 본문입니다. 생성 시 프로젝트, 현재 버전, 필수 값, 설정된 담당자와 버전 참조를 재검증합니다. 오래된 선택은 409이며 UI 초안을 보존합니다. 생성된 이슈의 템플릿 ID/버전은 읽기 전용 출처이며 일반 PATCH로 바꿀 수 없습니다.

인증 actor+UUID의 같은 정규화 요청은 기존 이슈를 반환합니다. 다른 내용의 같은 UUID, 삭제된 대상 재생성은 409입니다. 네트워크 실패 후 UI는 UUID를 유지하므로 성공 여부를 모르는 재시도로 이슈를 복제하지 않습니다. 반환 전 현재 이슈 권한을 다시 확인합니다. 템플릿의 문구·담당자 설정은 권한을 부여하거나 에이전트를 실행하지 않습니다.

## API / MCP

| 경로                                       | 동작                                                         |
| ------------------------------------------ | ------------------------------------------------------------ |
| `GET /api/projects/:id/templates`          | 현재 프로젝트의 활성 목록                                    |
| `GET /api/projects/:id/template-assignees` | 이름/ID/역할만 포함한 허용 담당자 목록                       |
| `POST /api/projects/:id/templates`         | 소유자 생성; `name,body,requiredFields,defaults,operationId` |
| `GET /api/templates/:id?version=N`         | 정의 및 불변 버전 조회                                       |
| `PATCH /api/templates/:id`                 | 소유자 수정; 정의와 현재 `revision`                          |
| `DELETE /api/templates/:id`                | 소유자 삭제; 현재 `revision`                                 |
| `POST /api/templates/:id/preview`          | 읽기 권한의 순수 미리보기; `version?,values,body?`           |

관리 작업은 소유자/쓰기/프로젝트 범위와 revision CAS를 검사합니다. 읽기 전용 에이전트는 허용 범위의 목록/조회/미리보기만 가능합니다. 오류 응답은 `{error,code,fields?}`이며 필수 값 오류는 정확한 필드 키를 담습니다. UI는 충돌 시 최신 정의를 별도 검토하고 명시적으로 최신 revision 기준으로 초안을 유지합니다. 성공 응답을 즉시 확인된 상태로 수용하므로 후속 조회 실패가 과거 revision을 최신으로 되돌리지 않습니다.

MCP: `sticker_list_templates`, `sticker_get_template`, `sticker_preview_template`; 기존 `sticker_create_issue`에 같은 생성 메타데이터가 추가됩니다. 관리/실행/승인 도구는 추가하지 않습니다.

## 저장·이관·검증

`006-templates.ts`는 `issue_templates`, `template_versions`, `template_operations`, `issue_creation_operations`와 이슈 출처 두 열만 추가합니다. migration registry/manifest는 구현된 v1–v6만 지원하며 미래 DB는 수정 전 거부합니다. 백업 검증은 읽기 전용으로 정의 JSON, 현재 버전 존재, 이슈 출처의 정확한 버전/프로젝트를 확인합니다. StoreContext와 일반 createIssue 트랜잭션을 공유하며 기존 이슈·뷰·릴리스·첨부를 보존합니다. 리소스 연결 등 후속 기능은 이 버전에 구현되지 않았습니다.

자동 검증: `templates.test.ts`, `template-application.test.ts`, `templates-http.test.ts`, `mcp-templates.test.ts`, migration/backup 회귀, `tests/ui/templates.test.tsx`. 실제 브라우저 대상은 `tests/ui/templates.spec.ts`의 desktop/375px Chromium입니다. DOM/테스트 발견은 실제 브라우저 통과가 아니며 hosted 결과를 별도 확인해야 합니다.
