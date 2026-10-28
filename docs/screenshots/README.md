# README 화면 이미지

이 디렉터리의 PNG 4개는 수정한 UI 시안이나 합성 이미지가 아니라, 실제 앱을 Chromium으로 실행하고 촬영한 1600×1050 화면입니다.

- 촬영 소스: `f5fd8bfa6e4c6eb13a98cf9b65a807502def7485` (`main` 앱 소스와 동일, 캡처 스크립트·워크플로만 추가)
- 촬영일: 2026-10-28
- [성공한 GitHub Actions 실행](https://github.com/oozoofrog/sticker/actions/runs/40672938842)
- 임시 SQLite와 가상 프로젝트·이슈·댓글·링크·자기 보고만 사용했습니다.
- 실제 계정·운영 데이터·에이전트 토큰은 사용하지 않았습니다. 화면 속 Codex 이름과 상태도 예시입니다.

## 재촬영

Node.js 24와 Chromium을 실행할 수 있는 환경에서:

```bash
npm ci
npm run build
npx playwright install --with-deps chromium
# Linux에서는 한글 글꼴(fonts-noto-cjk 등)도 설치합니다.
node scripts/capture-readme.mjs
```

스크립트는 loopback 포트 8791에 자체 임시 앱을 띄웁니다. 임시 데이터는 완료 후 제거합니다. 운영 앱 주소나 자격증명을 받지 않으며, 현재 디렉터리의 `.env`를 읽지 않습니다. 생성되는 PNG는 이 디렉터리의 동일 파일을 덮어씁니다.

## 검증 범위

실제 브라우저에서 로그인 후 보드, 이슈 상세, 버전 목록, 에이전트 기록 화면의 요소 표시와 브라우저 런타임 오류 없음을 확인했습니다. 네 장 모두 이미지를 열어 한글·레이아웃·가상 데이터 표시를 시각적으로 검토했습니다.

이는 **전체 E2E 또는 모바일 테스트 통과를 의미하지 않습니다.** Docker 이미지 빌드·컨테이너 실행 검증도 별개입니다. 기존 검증 기록의 다른 한계는 그대로입니다.
