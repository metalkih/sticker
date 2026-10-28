# 버전 출시 검토

버전 목록의 이름을 열면 목표·발견·수정 이슈를 각각 조회합니다. 목표 집계는 미완료, 구현 완료(done), 소유자 종결(closed)을 구분하고 차단은 중첩 표시합니다. 선행 이슈는 소유자 종결 전까지 차단으로 남습니다. 빈 범위는 완료율 100%로 간주하지 않습니다.

출시 검토에서 미종결 이슈를 선택하고 계획 상태의 다음 버전으로 이관할 내용을 먼저 확인합니다. 확인된 이관은 목표 버전만 바꾸며 발견/수정 버전과 상태를 보존합니다. 현재 revision이 달라진 항목은 성공 항목과 분리해 충돌로 반환하고 조용히 덮어쓰지 않습니다. 선택/버전 범위가 잘못되면 어떤 이슈도 이동하지 않습니다. 소유자가 아닌 에이전트는 종결된 이슈를 이동할 수 없습니다.

변경로그 초안은 이 버전의 목표·발견·수정 범위 중 명시적으로 선택한 이슈를 사용합니다. 생성되는 제목/링크 문구는 Markdown 구문·HTML 삽입을 이스케이프하며 링크는 운영자가 설정한 APP_ORIGIN의 이슈 경로입니다. 임의 근거 URL이나 PR을 추측하지 않습니다. 편집/저장은 revision으로 보호하고 이전 저장본을 감사 이력으로 보존합니다. 내보내기는 저장된 평문 Markdown 파일이며 웹 페이지로 실행하지 않습니다. 미저장 초안을 버리고 닫기 전에는 확인합니다.

출시 상태 전환은 소유자의 확인, 최신 버전 revision과 작업 UUID를 요구합니다. 같은 작업/내용을 재전송하면 원래 결과를 돌려주고 감사 행을 중복 생성하지 않습니다. 같은 UUID에 다른 내용을 보내면 409를 반환합니다. 일반 버전 생성/PATCH로 released에 진입하거나 released에서 벗어날 수 없습니다. 소유자는 출시 검토에서 계획/출시/보관 상태 전환을 명시적으로 기록합니다. 이전 DB에서 이미 출시된 버전은 그대로 유지하며 가짜 과거 감사 이력을 만들지 않습니다.

이 기능은 **앱 내부 출시 메타데이터**만 기록합니다. GitHub Release 발행, 빌드·배포, App Store 제출, 이슈 자동 종결은 수행하지 않습니다. 초안 저장, 이관, 출시 확인은 서로 독립적인 명시적 동작이며 검토창을 열거나 닫는 것만으로 이동/출시하지 않습니다.

## HTTP / MCP

- GET `/api/versions/:id/readiness`: 인증/프로젝트 범위가 적용된 세 역할의 이슈, 집계, 차단 ID 및 출시 감사 이력.
- POST `/api/versions/:id/carryover/preview` 및 `/carryover`: `{revision,destinationVersionId,destinationRevision,operationId,issues:[{issueId,revision}]}`. 미리보기는 쓰지 않습니다. 실행은 항목별 moved/conflict/failed 결과를 반환합니다.
- GET/PUT `/api/versions/:id/changelog`: PUT은 `{revision,selectedIssueIds,markdown}`. 최초 revision은 0입니다.
- POST `/api/versions/:id/changelog/generate`: `{revision,selectedIssueIds}`. 생성한 초안을 저장합니다.
- GET `/api/versions/:id/changelog/export`: 인증된 `text/markdown` 다운로드.
- POST `/api/versions/:id/release`: `{revision,operationId,confirm:true,state?}`. state 기본값은 released이며 owner-only입니다.
- 일반 버전 PATCH는 현재 `revision`을 요구하며 정상 메타데이터 수정도 revision을 증가시킵니다.
- MCP `sticker_get_version_readiness`, `sticker_get_version_changelog`는 같은 API를 읽습니다. 에이전트 출시/확인 도구는 제공하지 않습니다.

## 저장과 검증

v4 마이그레이션은 버전 revision, 초안/이력, 출시 감사, 중복 작업 원장을 추가합니다. 기존 이슈/관계/세션/첨부를 삭제하거나 재작성하지 않습니다. 백업 검증은 구현된 v1–v4만 읽기 전용으로 지원하며 복원 후 앱 시작 시 마이그레이션합니다. 미래 스키마를 지원한다고 표시하지 않습니다.

도메인/HTTP/MCP/CAS/권한/마이그레이션 테스트와 DOM 회귀 테스트를 제공합니다. `tests/ui/releases.spec.ts`는 실제 호스팅 CI의 desktop/375px 브라우저 검증 대상입니다. DOM 테스트가 성공했다는 것만으로 시각·모바일 검증 완료를 뜻하지 않습니다. `tests/container-release-smoke.mjs`는 Docker lifecycle의 초기화/재생성/백업복원에서 출시 감사·초안·버전 연결을 확인하는 전용 테스트이며 운영 DB에서 실행하지 않습니다.
