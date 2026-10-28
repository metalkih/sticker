# 프로젝트·버전 공통 자료 계약

자료는 로컬 앱의 프로젝트 데이터입니다. 문서 내용, 링크, 파일 또는 지침 지정은 실행 승인이나 권한을 부여하지 않습니다. 서버는 저장한 외부 URL을 수집하지 않습니다. 작성자·시각·프로젝트 권한은 서버가 결정하며 클라이언트는 작성자나 내부 저장 키를 지정할 수 없습니다.

## 데이터와 변경

- `Resource`는 필수 `projectId`, 선택 `versionId`, `kind: markdown|file|link`, 제목, 현재 내용 버전, 수정 `revision`, 지침 표시와 삭제 시각을 가집니다. 프로젝트와 kind는 변경할 수 없습니다. 소속 버전은 같은 프로젝트여야 합니다.
- 내용·제목 변경은 새로운 불변 `resource_versions`를 만듭니다. 수정 주체·시각과 파일 SHA256/크기를 보존합니다. 지침 표시만 바뀌면 메타데이터 revision만 증가합니다. 이벤트 이력에는 지정/해제/삭제 주체도 남습니다.
- 수정/삭제/지침 변경은 현재 `revision`과 UUID `operationId`가 필요합니다. 동일 인증 주체의 같은 종류·작업 ID 재시도는 최초 응답을 반환하고, 입력이 달라지면 `OPERATION_CONFLICT`409입니다. 모든 재시도도 현재 프로젝트 권한을 먼저 확인합니다. 오래된 revision은409이며 자동 덮어쓰지 않습니다.
- 소유자만 지침을 지정/해제합니다. 지정된 지침의 내용 변경·삭제 역시 소유자만 가능합니다. 일반 에이전트 작성 자료는 지침으로 자동 승격되지 않습니다.
- 활성 자료가 있으면 프로젝트 삭제도409입니다. 자료를 명시적으로 삭제한 뒤의 프로젝트 삭제는 기존 프로젝트 수명 정책을 따릅니다.
- 삭제는 tombstone입니다. 현재 내용은 `null`이고 새 연결/수정은 거부하지만 기존 참조·불변 버전·파일을 지우지 않습니다. 명시적으로 지정한 이전 버전은 기존 권한으로 읽을 수 있습니다. 삭제된 소속 앱 버전 ID도 보존하며 `versionAvailable:false`로 표시합니다.
- 이슈 연결은 정확한 자료 버전을 고정합니다. 한 연결 해제는 다른 연결이나 파일을 삭제하지 않습니다. 결과 참조 역시 실제 세션 결과 이벤트와 자료 버전을 고정하고 서버가 기록 주체를 남깁니다.

## HTTP

기존 `/api` 로그인/Origin 검사 안에 마운트됩니다. 모든 검색·상세·버전·파일·연결·결과 조회는 현재 프로젝트와 연결된 이슈/세션의 권한을 다시 확인합니다.

| 경로                                            | 요청/응답                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/resources`                            | `projectId?`, `versionId?`, `kind?`, `query?` → 활성 자료 목록                                       |
| `POST /api/resources/query`                     | 같은 엄격한 검색 객체 → 목록. `versionId:null`은 소속 버전 없는 자료만 선택                          |
| `POST /api/resources`                           | `{projectId,versionId?,title,kind:'markdown',markdown,operationId}` 또는 `kind:'link',url` → 상세201 |
| `GET /api/resources/:id`                        | 헤더, 현재 내용 또는null, 불변 버전 요약, 이벤트와 사용처                                            |
| `GET /api/resources/:id/versions/:version`      | 명시한 불변 내용 버전                                                                                |
| `PATCH /api/resources/:id`                      | `{revision,operationId,title?,versionId?,markdown?}` 또는 `url?` (동시 전송 불가) → 상세             |
| `DELETE /api/resources/:id`                     | `{revision,operationId}` → tombstone 상세                                                            |
| `PATCH /api/resources/:id/guidance`             | owner-only `{revision,operationId,isGuidance}`                                                       |
| `GET /api/projects/:id/guidance`                | 소유자가 지정한 활성 지침 상세 목록                                                                  |
| `POST /api/projects/:id/resources/files`        | multipart `file` 하나 + JSON 문자열 `metadata:{title,versionId?,operationId}` → 상세201              |
| `POST /api/resources/:id/files`                 | multipart `file` + `metadata:{revision,operationId,title?,versionId?}` → 새 파일 버전 상세           |
| `GET /api/resources/:id/versions/:version/file` | 권한을 확인한 해당 버전 파일 다운로드                                                                |
| `GET/POST /api/issues/:id/resources`            | 목록 또는 `{resourceId,resourceVersion?,issueRevision,operationId}` → 정확한 버전 연결201            |
| `DELETE /api/issues/:id/resources/:linkId`      | `{issueRevision,operationId}` → `{removed:true}`                                                     |
| `GET /api/sessions/:id/resources`               | 해당 세션의 고정된 결과 참조 목록                                                                    |
| `POST /api/resource-references`                 | `{sessionId,eventId,resourceId,resourceVersion,operationId}` → 결과 참조201                          |

연결 생성에서 `resourceVersion`을 생략하면 그 변경 시점의 현재 버전을 한 번 고정합니다. 재시도나 후속 조회에서 최신 버전으로 바꾸지 않습니다. 연결/해제는 이슈 revision을 올리며 종료 이슈의 소유자 경계도 유지합니다. 에이전트 결과 참조는 자신의 세션의 기록된 `result` 이벤트만 가능하며 닫힌 세션이나 연결된 종료 이슈의 기존 변경 제한을 우회하지 않습니다. 참조 기록은 실행·검증 성공이나 새로운 자기 보고 시각을 만들지 않습니다.

파일은 웹/API20 MiB, MCP5 MiB까지입니다. 바이트에서 안전한 래스터 MIME만 감지하며 SVG/HTML 등은 attachment로 내려보냅니다. `?preview=1`도 감지된 PNG/JPEG/GIF/WebP만 inline을 허용하고 nosniff·sandbox를 적용합니다. 파일 이름은 경로/제어 문자를 제거하고 기존255 UTF-16 단위 상한에서 문자 중간을 자르지 않습니다. 내부 파일명은 UUID이며 배타적으로 생성합니다. 실패·중복 업로드는 새로 소유한 파일만 정리하고 이전 버전/EEXIST 파일을 지우지 않습니다. 응답에는 storageKey/호스트 경로가 없습니다.

## 백업·검증 경계

자료 테이블은 실제 migration007에 등록되어 있습니다. 이 변경에서 스키마1–7 백업을 지원하며 이후 지원 범위는 고정 `schemaManifests`의 실제 구현을 따릅니다. 복원 전 검증은 tombstone·이전 버전을 포함한 모든 자료 파일의 UUID, 크기, SHA256, 실제 파일/디렉터리를 확인하고 같은 파일을 쓰는 버전의 메타데이터가 일치해야 합니다. 소실·같은 크기의 손상도 기존 데이터를 교체하기 전에 거부합니다.

`tests/container-resources.test.ts`는 독립된 임시 서버/실제 HTTP에서 컨테이너용 fixture의 초기화, 서버 재생성, 백업 검증/복사 복원을 검사합니다. 실제 Docker 빌드·볼륨 복원 결과는 별도 컨테이너 CI에서 확인해야 하며 이 native 검증만으로 Docker나 실제 브라우저 호환성을 주장하지 않습니다.
