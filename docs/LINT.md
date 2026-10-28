# 엄격한 TypeScript·React 린트와 CI

스티커에는 Swift 파일이 없으므로 SwiftLint를 적용하지 않습니다. Node 24 + TypeScript/React에 맞춰 ESLint 10.13.0, typescript-eslint 8.72.1, eslint-plugin-react-hooks 7.1.1을 정확한 버전으로 고정했습니다.

## 실행

```sh
npm ci
npm run lint            # error 또는 warning이 있으면 실패
npm run lint:report     # 동일 검사 + 로컬 lint-report.json 생성
npm run test:lint       # 잘못된 코드가 실제 규칙에 걸리는 설정 계약 검사
npm run typecheck
npm test
npm run build
npm run test:production
npm run format:check
```

`lint-report.json`은 로컬 생성물이며 Git에 저장하지 않습니다. 앱·서버·테스트·설정 파일을 검사하고, node_modules/dist/test-results/playwright-report/coverage만 생성물로 제외합니다. TypeScript는 projectService 기반 strictTypeChecked, 클라이언트 및 UI 테스트의 TS/TSX는 React Hooks recommended 규칙을 사용합니다. JavaScript 도구의 Node 전역과 브라우저 전역은 분리합니다. 기존 TypeScript strict 설정은 유지합니다.

## 초기 기준선 (2026-10-28)

운영 소스는 main `db64629b237cf88f50ef0c2945b521982d21b455`와 동일합니다. 이 변경은 린트/CI 설정이며 앱 코드를 일괄 수정하지 않습니다.

- `npm run lint`: **실패 — 468 errors, 1 warning, parser fatal 0**, 진단이 있는 파일 25개.
- `npm run test:lint`: **5 통과**. unsafe 타입·floating promise·조건부 hook, 일반 `.ts` hook, 서버/테스트 포함, 생성물 제외, JS 환경 전역 분리를 검증합니다.
- 기존 앱 테스트: **54 통과**, typecheck/build/compiled-server smoke/format 통과.
- `npm audit`: 알려진 취약점 **0** (검사 시점).

진단을 개선 작업 9개로 묶었습니다. 469개 런타임 버그가 있다는 뜻이 아닙니다.

| 개선 그룹                           |            진단 수 |
| ----------------------------------- | -----------------: |
| RequestInit.headers 정규화          |                  1 |
| React Hooks/렌더 정책               | 6 (warning 1 포함) |
| 운영 코드 unsafe 경계               |                 25 |
| 테스트 unsafe 타입                  |                158 |
| 비동기 콜백/Promise 정책            |                 68 |
| 단언·조건·타입 좁히기               |                 46 |
| 문자열 보간/변환                    |                 59 |
| void 반환 표현                      |                 90 |
| 미사용·deprecated·정규식·빈 블록 등 |                 16 |

특히 `node:test` 등록 반환 Promise의 no-floating-promises 50건은 테스트 러너가 실패를 처리하는 호출도 포함합니다. 처리 의도를 명시하거나 정밀한 정책을 선택하는 과제이지 미처리 rejection 장애로 확정한 것이 아닙니다. strictTypeChecked에는 표현·타입 의도를 강제하는 규칙도 있으므로 실제 결함 여부를 별도로 검토해야 합니다. `--max-warnings 0`과 오류 기준은 그대로 유지하며 baseline 무시·파일 제외·continue-on-error로 결과를 녹색으로 만들지 않습니다.

## GitHub Actions

`.github/workflows/quality.yml`은 push(main/chore 브랜치) 및 pull_request에서 lint, 설정 계약 테스트, typecheck, 앱 테스트, build/production smoke, formatting을 독립 matrix job으로 실행합니다. lint가 실패해도 다른 검사 결과는 확인되지만, 린트 job의 실패는 숨기지 않습니다. timeout 15분, fail-fast false, contents:read, 체크아웃 자격증명 비보존, SHA 고정 actions/checkout·setup-node를 사용합니다. 운영 비밀번호/토큰·배포·쓰기 권한은 없습니다. 검증 완료를 뜻하는 required branch protection 설정은 별도이며 이 변경에 포함하지 않습니다.

## 범위와 한계

- JSX-a11y stable 6.10.2의 peer 범위가 ESLint 9까지이고 ESLint 9는 EOL이므로, 현재 설정에는 강제 설치하지 않습니다. **정적 접근성 전용 plugin 검사를 수행했다고 주장하지 않습니다.** 키보드·스크린리더·실브라우저 검증이 별도로 필요합니다.
- Docker 이미지/컨테이너 실행 및 실제 브라우저 UI 검증은 이 작업에 포함하지 않습니다.
- strict preset은 같은 major에서도 규칙이 달라질 수 있어 버전을 고정했습니다. 업데이트 시 계약 테스트와 전체 baseline을 재확인합니다.
- [ESLint 지원 버전](https://eslint.org/version-support/), [typescript-eslint 설정](https://typescript-eslint.io/users/configs/), [React Hooks plugin](https://react.dev/reference/eslint-plugin-react-hooks).
