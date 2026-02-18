# Detection Rules

이 문서는 탐지 룰셋 버전과 fixture 회귀 테스트 기준을 정의합니다.

## Ruleset Version
- 현재 버전: `2026.02.14.1`
- 정의 위치: `packages/shared/src/index.ts` (`DETECTION_RULESET_VERSION`)
- 메트릭 노출: `leak_worker_detection_ruleset_info{version="..."} 1`

## Fixture 기준
- fixture 소스: `services/worker/src/__tests__/detection-fixtures.ts`
- 실행 테스트: `services/worker/src/__tests__/detection-fixtures-smoke.ts`
- 리포트 생성: `pnpm -w --filter @leak/worker run report:fixtures`
- 리포트 파일: `DETECTION_FIXTURES_REPORT.md`

현재 fixture 범주:
- 정탐: openai, anthropic, google, grok, kimi, deepseek, mistral
- 정탐: stripe, aws, slack, sendgrid, github, npm, supabase, vercel, discord
- 오탐 방지: placeholder, templating reference, env reference, low entropy, comment noise

## 변경 절차
1. 탐지 규칙 변경 (`services/worker/src/detection.ts`)
2. fixture 추가/수정 (`services/worker/src/__tests__/detection-fixtures.ts`)
3. 필요 시 룰셋 버전 증가 (`DETECTION_RULESET_VERSION`)
4. `pnpm -w run test`로 회귀 확인
5. `PROGRESS.md`와 본 문서에 변경 내역 기록
6. `report:fixtures` 실행 후 리포트 갱신 확인

## 버전 규칙
- 형식: `YYYY.MM.DD.N`
- 같은 날짜 내 룰셋 추가 변경 시 `N` 증가
