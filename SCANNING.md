# 스캔 모드와 비용

이 문서는 자동/수동/예약 스캔의 동작 방식과 비용을 설명합니다.
모든 public 이벤트 스캔을 기준으로 작성했습니다.

## 스캔 모드

### 자동 스캔(기본)
- 워커가 상시 실행되며 GitHub Events API를 주기적으로 폴링
- 결과가 부족하면 로테이션 쿼리로 백필(Commit/Code Search)
- 자동 스캔은 **AI 모델 provider만 저장**
  - openai, anthropic, google, grok, kimi, glm, deepseek, mistral

### 수동 스캔(옵션)
- 웹 UI의 "지금 스캔" 버튼으로 실행
- provider를 **다중 선택**하여 해당 provider만 탐지
- 선택된 provider는 GitHub Search 쿼리로 변환되어 백필에 사용
- provider payload는 중복/공백 값을 정리한 뒤 처리됩니다.

### 예약 스캔(옵션)
- 모드에서 "예약" 선택 후 저장
- 최소 간격: 60분
- 매 간격마다 스캔 작업 생성
- 수동 스캔과 동일한 흐름 사용

## API 엔드포인트
- `POST /scan-requests`
  - Body (providers 방식): `{ "providers": ["openai", "anthropic"] }`
  - Body (query 방식): `{ "query": "sk-proj-" }`
  - 유효성 규칙: `query`와 `providers` 동시 사용 불가, 둘 중 하나는 필수
  - providers는 지원 목록 화이트리스트 검증 후 처리
  - 결과: 스캔 잡 레코드

- `POST /scan-schedules`
  - Body: `{ "intervalMinutes": 60, "query": "sk-proj-", "enabled": true }`
  - 유효성 규칙: `intervalMinutes >= 60`, `enabled`는 boolean
  - 결과: 스케줄 레코드

- `GET /scan-schedules`
  - 결과: 스케줄 목록

- `GET /internal/worker-status`
  - 결과: 워커 보관 정책/레이트리밋 상태 스냅샷

- `GET /internal/slo`
  - 결과: SLO 임계치/현재값/준수여부(JSON)

- `GET /internal/metrics`
  - 결과: Prometheus 형식 메트릭 (보관 정책/레이트리밋)
  - 포함 지표: cycle count/duration, 자동·수동 삽입건, 수동 job 오류건
  - 누적 지표: auto/manual 삽입 및 오류 카운터
  - 파생 지표: auto/manual error ratio, status age(ms)
  - 파생 지표: auto insert ratio(최근 처리 대비 삽입 비율)
  - 룰셋 버전 지표: `leak_worker_detection_ruleset_info{version=...}`
  - SLO 지표: `leak_worker_slo_status_freshness_met`, `leak_worker_slo_auto_error_ratio_met`, `leak_worker_slo_overall_met`
  - 연동 예시: `OBSERVABILITY.md`
  - Alert 프로파일: local/staging/production 룰 파일 제공
  - Alertmanager 라우팅 예시: `infra/monitoring/alertmanager.routes.leak-radar.yml`
  - production critical 알림은 PagerDuty + ticket webhook 자동 액션 사용
  - ticket webhook payload schema/example 제공 (`infra/monitoring/ticket-webhook.*`)

- `POST /scan-schedules/:id/toggle`
  - Body: `{ "enabled": true }`
  - 결과: 변경된 스케줄 레코드

## 사용되는 GitHub API
- Events API: `GET https://api.github.com/events`
  - 공개 푸시 이벤트를 거의 실시간으로 탐색
- Commit Search API: `GET https://api.github.com/search/commits?q=<query>`
  - 백필/타깃 검색용
  - preview 헤더 필요: `application/vnd.github.cloak-preview+json`
- Code Search API: `GET https://api.github.com/search/code?q=<query>`
  - 파일 내용 기반 검색
  - 백필 품질 향상에 사용

## 레이트리밋
- Events API: 상대적으로 여유 있음
- Commit Search API: 매우 낮음(과도 사용 금지)
- Code Search API: 낮은 편(과도 사용 금지)
- 워커는 reset 시각까지 대기 및 백오프

## 비용 예상(월간, USD)

### 로컬 실행(개발용)
- 비용: $0
- 자동 스캔을 쓰려면 컴퓨터가 켜져 있어야 함

### 소형 VPS(1 vCPU, 1GB)
- Events 중심 폴링 + 제한적 백필
- 비용: 약 $5~$10

### 관리형 DB + VPS(중간)
- Events + 제한적 백필
- 비용: 약 $20~$50

### 고빈도(준실시간)
- 잦은 폴링 + 백필
- 비용: 약 $80~$200+

## 권장 기본값
- 기본: 자동 스캔
- 예약 스캔: 최소 60분
- 백필: 필요 시에만(또는 빈 결과 시)
