# Node / 컨테이너 기반 고정과 갱신 정책

## 현재 고정값과 확인 근거

- Node: **24.22.1 LTS**. [공식 2026-10-21 릴리스 안내](https://nodejs.org/en/blog/release/v24.22.1)는 이 패치를 보안 릴리스로 명시합니다.
- Docker 공식 이미지: `docker.io/library/node:24.22.1-bookworm-slim`.
- **다중 아키텍처 OCI index digest:** `sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c`.

2026-10-28에 [Docker Hub의 정확한 태그 메타데이터](https://hub.docker.com/v2/repositories/library/node/tags/24.22.1-bookworm-slim)와 [공식 registry manifest](https://registry-1.docker.io/v2/library/node/manifests/24.22.1-bookworm-slim)를 조회했습니다. registry의 `Docker-Content-Digest`, 응답 본문 SHA-256, Hub digest가 일치했습니다. 공식 registry의 익명 공개 pull 인증만 사용했으며 계정·개인 토큰은 필요하지 않았습니다.

index에는 `linux/amd64`, `linux/arm64/v8`, `linux/ppc64le` 이미지가 있습니다. 각 플랫폼 manifest와 config blob의 SHA-256도 검증했고, config의 `NODE_VERSION`은 모두 `24.22.1`이었습니다. **이것은 이미지 메타데이터 확인이며 해당 플랫폼에서 앱을 실행했다는 뜻은 아닙니다.** 특정 amd64 manifest digest로 바꾸거나 `--platform=linux/amd64`를 고정하지 않습니다.

## 하나의 버전 원천

`Dockerfile`의 첫 `FROM`만 외부 이미지를 참조합니다. `base`는 패치 태그와 index digest로 고정된 깨끗한 스테이지이며, `build`와 `runtime`이 같은 `base`를 상속합니다. 빌드 도구/소스가 runtime에 섞이지 않는 기존 다단계 구조를 유지합니다. npm 패키지는 기존 `package-lock.json`과 `npm ci`를 유지합니다.

`scripts/container-toolchain.sh`는 이 저장소의 정형 Dockerfile을 읽고 다음을 수행합니다.

- 공식 `node:24.<minor>.<patch>-bookworm-slim@sha256:<64 hex>` 기반 하나만 허용합니다.
- build/runtime이 별도 외부 태그를 참조하거나, 기반이 누락되거나, major만 고정되면 CI 전에 거부합니다.
- Quality와 화면 촬영 workflow가 `setup-node`에 전달할 **정확한 패치**를 출력합니다. 별도 `.nvmrc`/workflow 숫자를 수동 동기화할 필요가 없습니다.

CI는 실제 `node --version`, `npm --version`, 기반 참조와 digest, runner `ImageOS`/`ImageVersion`을 기록합니다. 컨테이너 검증은 실제 runtime Node 패치가 고정값과 일치하는지 확인하고, immutable digest로 조회한 index에 amd64/arm64/ppc64le가 남아 있는지 검사합니다. 이 검증에는 Docker Buildx 플러그인도 필요합니다. 빌드된 앱 이미지 ID와 Docker/Compose/Buildx 버전도 로그에 남깁니다. 로그는 해당 실행의 증거이며, workflow 파일 자체는 성공 증거가 아닙니다.

## 보안 갱신은 PR로 검토

`.github/dependabot.yml`은 공개 Docker 기반, npm 의존성, SHA 고정 GitHub Actions의 갱신을 매주 확인하도록 구성합니다. 개인 PAT·레지스트리 비밀번호·추가 쓰기 workflow 권한이 없습니다. 자동 병합이나 자동 배포는 구성하지 않습니다. Node major 변경은 의도적으로 제외하며, LTS 지원 범위를 바꾸는 별도 검토가 필요합니다.

GitHub는 Docker 다단계/첫 `FROM` 업데이트에 [제약을 문서화](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-private-registries#limitations-and-workarounds)합니다. 그래서 외부 기반을 첫 `FROM` 한 곳에만 둡니다. Dependabot의 [공식 updater 테스트](https://github.com/dependabot/dependabot-core/blob/510dd5e861be74ddc533083fe8b9953a66670f2f/docker/spec/dependabot/docker/file_updater_spec.rb)는 digest 참조 갱신을 다룹니다. 그래도 봇이 모든 상황을 처리한다고 가정하지 않습니다. 실제 갱신 PR/실행이 생기는지 확인하고, 누락되면 아래 절차로 유지보수자가 PR을 만듭니다.

갱신 PR의 필수 검토 절차:

1. 공식 Node 릴리스/보안 안내와 Docker 공식 태그를 확인합니다. 같은 Node 패치라도 Debian/이미지 보안 갱신으로 digest만 바뀔 수 있습니다.
2. tag와 **index** digest를 공식 registry에서 확인합니다. 단일 플랫폼 digest나 출처 불명 해시를 복사하지 않습니다. 아키텍처 목록과 Node 패치를 확인하고 이 문서의 고정값/확인 날짜를 갱신합니다.
3. 첫 `FROM`의 태그+digest만 갱신합니다. Actions의 SHA 고정, `npm ci`, lockfile integrity를 제거하지 않습니다. npm 갱신은 lockfile도 함께 검토합니다.
4. 정확한 PR HEAD에서 Quality와 실제 Docker lifecycle CI가 모두 성공해야 합니다. 인증·DB/첨부 영속성·백업/복원·MCP 회귀를 확인합니다. 검토자/소유자의 정상 승인과 병합 절차를 거칩니다.
5. 보안 공지는 매주 봇 일정만 기다리지 말고 우선 검토합니다. 테스트 실패를 피하려고 가변 태그로 되돌리거나 무기한 갱신을 멈추지 않습니다. 긴급 롤백은 이전 검증 커밋의 기반으로 되돌리는 별도 PR로 남기고 보안 영향도 설명합니다.

봇 스케줄이나 이 정책은 보안 알림을 실시간 보장하지 않습니다. 생성된 PR은 설치/배포 승인이 아니며 자동으로 운영 환경을 바꾸지 않습니다.

## 보장하지 않는 것

- `ubuntu-24.04`로 OS 계열을 명시하지만 GitHub-hosted runner의 주기적 이미지 갱신은 계속됩니다. Docker Engine/BuildKit 버전도 달라질 수 있습니다. 기록된 `ImageVersion`과 빌더 버전으로 회귀를 비교합니다.
- 패치 태그만으로는 이미지 불변성이 보장되지 않아 digest도 함께 고정합니다. digest는 기존 기반 바이트의 식별자이지 최신 보안 패치 보증이 아닙니다.
- npm lockfile과 기반 digest가 있어도 빌더, 타임스탬프, 다운로드 가용성, 레지스트리 보존, npm 설치 스크립트 등 전체 빌드 입력이 고정되는 것은 아닙니다. **비트 단위 동일 이미지나 완전 오프라인 빌드**를 보장하지 않습니다.
- 다중 아키텍처 기반을 보존하는 것과 앱의 모든 아키텍처/Windows/macOS 검증은 다릅니다. 실제 CI가 실행한 플랫폼만 검증 완료로 기록합니다.
