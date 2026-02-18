# 관측(Observability) 가이드

이 문서는 Leak Radar의 워커 상태를 메트릭으로 수집하고,
Grafana/Alertmanager와 연동하는 최소 예시를 제공합니다.

## 엔드포인트
- 상태 JSON: `GET /internal/worker-status`
- SLO JSON: `GET /internal/slo`
- Prometheus 메트릭: `GET /internal/metrics`

`/internal/slo` 포함 필드:
- `thresholds.statusAgeMsMax`
- `thresholds.autoErrorRatioMax`
- `values.statusAgeMs`, `values.autoErrorRatio`, `values.autoInsertRatio`, `values.manualErrorRatio`
- `met.statusFreshness`, `met.autoErrorRatio`, `met.overall`

## 주요 메트릭
- 보관 정책
  - `leak_worker_retention_enabled`
  - `leak_worker_retention_days`
  - `leak_worker_retention_last_deleted`
- 레이트리밋
  - `leak_worker_ratelimit_remaining{api="events|commits|code"}`
  - `leak_worker_ratelimit_limit{api="events|commits|code"}`
  - `leak_worker_ratelimit_reset_after_ms{api="events|commits|code"}`
- 파이프라인
  - `leak_worker_pipeline_cycle_count`
  - `leak_worker_pipeline_cycle_duration_ms`
  - `leak_worker_pipeline_last_auto_inserted`
  - `leak_worker_pipeline_last_auto_events_jobs`
  - `leak_worker_pipeline_last_auto_backfill_code_items`
  - `leak_worker_pipeline_last_auto_backfill_commit_items`
  - `leak_worker_pipeline_last_auto_errors`
  - `leak_worker_pipeline_last_manual_inserted`
  - `leak_worker_pipeline_last_manual_jobs_processed`
  - `leak_worker_pipeline_last_manual_jobs_errored`
  - `leak_worker_pipeline_last_auto_insert_ratio`
  - `leak_worker_pipeline_last_auto_error_ratio`
  - `leak_worker_pipeline_last_manual_error_ratio`
  - `leak_worker_status_age_ms`
  - `leak_worker_pipeline_total_auto_inserted`
  - `leak_worker_pipeline_total_auto_errors`
  - `leak_worker_pipeline_total_manual_inserted`
  - `leak_worker_pipeline_total_manual_jobs_processed`
  - `leak_worker_pipeline_total_manual_jobs_errored`
  - `leak_worker_detection_ruleset_info{version="..."}`
  - `leak_worker_slo_status_freshness_met`
  - `leak_worker_slo_auto_error_ratio_met`
  - `leak_worker_slo_overall_met`

## Prometheus scrape 예시
```yaml
scrape_configs:
  - job_name: leak-radar-api
    metrics_path: /internal/metrics
    static_configs:
      - targets: ["localhost:4000"]
        labels:
          service: leak-radar
          env: local
```

프로덕션 권장 라벨 규약:
- `service`: `leak-radar`
- `env`: `staging | production`
- `region`: `ap-northeast-2` 등 배포 리전
- `team`: `leak-platform`
- `owner`: `security-ops`

## Grafana 패널 추천
- Cycle Duration: `leak_worker_pipeline_cycle_duration_ms`
- Auto Errors: `leak_worker_pipeline_last_auto_errors`
- Rate Limit Remaining:
  - `leak_worker_ratelimit_remaining{api="events"}`
  - `leak_worker_ratelimit_remaining{api="commits"}`
  - `leak_worker_ratelimit_remaining{api="code"}`
- SLO Compliance:
  - `leak_worker_slo_status_freshness_met`
  - `leak_worker_slo_auto_error_ratio_met`
  - `leak_worker_slo_overall_met`

## Grafana 대시보드 템플릿 (축약 예시)
```json
{
  "title": "Leak Radar Worker",
  "panels": [
    {
      "type": "timeseries",
      "title": "Cycle Duration (ms)",
      "targets": [{ "expr": "leak_worker_pipeline_cycle_duration_ms" }]
    },
    {
      "type": "timeseries",
      "title": "Auto Errors",
      "targets": [{ "expr": "leak_worker_pipeline_total_auto_errors" }]
    },
    {
      "type": "timeseries",
      "title": "RateLimit Remaining",
      "targets": [
        { "expr": "leak_worker_ratelimit_remaining{api=\"events\"}" },
        { "expr": "leak_worker_ratelimit_remaining{api=\"commits\"}" },
        { "expr": "leak_worker_ratelimit_remaining{api=\"code\"}" }
      ]
    }
  ]
}
```

실사용 템플릿 파일:
- `infra/monitoring/grafana-dashboard.leak-radar-worker.json`
- 대시보드에는 firing alert annotation(`ALERTS{service="leak-radar"}`)이 포함됩니다.

Alert rule 파일:
- `infra/monitoring/alert-rules.leak-radar-worker.yml`
- 경고/치명도 2단계(`warning`, `critical`) 룰이 포함됩니다.

환경별 프로파일:
- local: `infra/monitoring/alert-rules.leak-radar-worker.local.yml`
- staging: `infra/monitoring/alert-rules.leak-radar-worker.staging.yml`
- production: `infra/monitoring/alert-rules.leak-radar-worker.production.yml`

Alertmanager 라우팅 예시:
- `infra/monitoring/alertmanager.routes.leak-radar.yml`
- `service/team/severity` 라벨을 기준으로 Slack/PagerDuty 수신자를 분기합니다.
- 운영 권장: `env=production,severity=critical`은 PagerDuty로 우선 라우팅
- production critical은 ticket webhook(`$TICKET_WEBHOOK_URL`)으로도 동시 전송됩니다.
- 중복 알림 억제: `inhibit_rules`로 critical 발생 시 동일 alert warning 억제

수신 채널 예시:
- production warning: `#leak-radar-prod-alerts`
- staging: `#leak-radar-staging-alerts`
- local: `#leak-radar-local-alerts`

권장 선택:
- 개발 PC/로컬 Docker: local
- 통합 테스트/사내 검증: staging
- 운영 환경: production

## Alertmanager 규칙 예시
```yaml
groups:
  - name: leak-radar-worker
    rules:
      - alert: LeakWorkerAutoErrorsHigh
        expr: leak_worker_pipeline_last_auto_errors >= 5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Leak Radar worker auto errors high"
          description: "최근 auto scan 오류가 임계치를 초과했습니다."

      - alert: LeakWorkerRateLimitExhausted
        expr: leak_worker_ratelimit_remaining{api="commits"} == 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Commit Search rate limit exhausted"
          description: "Commit Search 잔여 호출이 0입니다."
```

Slack 템플릿 변수 예시:
- `{{ .CommonLabels.alertname }}`
- `{{ .CommonLabels.env }}`
- `{{ .CommonLabels.severity }}`
- `{{ .CommonAnnotations.summary }}`
- `{{ .CommonAnnotations.description }}`

PagerDuty 템플릿 변수 예시:
- `description: "{{ .CommonLabels.alertname }}"`
- `details.summary: "{{ .CommonAnnotations.summary }}"`
- `details.description: "{{ .CommonAnnotations.description }}"`

Webhook(티켓) 페이로드 예시:
```json
{
  "receiver": "leak-radar-prod-ticket-webhook",
  "status": "firing",
  "commonLabels": {
    "alertname": "LeakWorkerSloOverallNotMetCriticalProd",
    "service": "leak-radar",
    "env": "production",
    "severity": "critical"
  },
  "commonAnnotations": {
    "summary": "[prod] worker SLO overall not met (critical)",
    "description": "SLO non-compliance has continued for more than 30 minutes",
    "runbook_url": "https://runbooks.leak-radar.dev/worker/slo",
    "ticket_payload_template": "leak_worker_critical"
  }
}
```

Webhook 스키마/샘플 파일:
- 스키마: `infra/monitoring/ticket-webhook.payload.schema.json`
- 예시: `infra/monitoring/ticket-webhook.payload.example.json`

## 운영 팁
- `reset_after_ms`는 급격히 증가할 수 있으므로 절대값보다 추세를 보세요.
- `cycle_duration_ms`와 `last_auto_errors`를 같이 보면 병목 지점을 빠르게 찾을 수 있습니다.
- `retention_last_deleted`가 급증하면 정책 변경 또는 입력 데이터 폭증 여부를 확인하세요.
- 탐지 규칙 변경 시 `leak_worker_detection_ruleset_info` 버전이 기대값으로 갱신됐는지 확인하세요.

## 장애 대응 Runbook
- `상태 stale 경고`: 워커 프로세스 상태(`pnpm -w run dev:worker`)와 DB 연결(`DATABASE_URL`) 확인 후 재기동
- `auto error ratio 급증`: GitHub API 응답 코드/레이트리밋 로그(`[RATELIMIT]`, `[SCAN]`) 점검, 토큰 교체 여부 확인
- `commit rate limit exhausted`: `reset_after_ms` 확인 후 검색 빈도 완화(`WORKER_POLL_INTERVAL_MS` 상향)
- `insert ratio 저하`: 최근 쿼리 로테이션(`ROTATING_QUERIES`)이 현재 유출 패턴과 맞는지 검토
- `manual job 오류 증가`: `/scan-jobs`에서 에러 메시지 확인 후 invalid query/provider payload 수정

### 알림 체크리스트
| Alert | 1차 확인 | 2차 조치 |
|---|---|---|
| status stale | 워커 프로세스 alive, `/internal/worker-status` 응답 | 워커 재기동, DB 연결/네트워크 점검 |
| auto error ratio high | 최근 `[SCAN]`/`[RATELIMIT]` 로그 확인 | GitHub 토큰 교체, 쿼리 강도 완화 |
| commit rate-limit exhausted | `reset_after_ms` 값, remaining 추이 확인 | poll interval 상향, 백필 모드 조정 |
| auto insert ratio low | events/backfill 수집량 대비 insert 확인 | 쿼리 로테이션 갱신, 패턴 룰 점검 |

### 자동 액션
- `severity=critical` + `env=production`:
  1) PagerDuty 알림 발송
  2) Ticket webhook 호출 (incident/ticket 자동 생성)
- 알림 annotation의 `runbook_url`을 티켓 설명 본문에 포함해 즉시 대응 경로 제공

## SLO/SLA 기준선 (초안)
- 상태 신선도 SLO: `leak_worker_status_age_ms < 300000`를 99% 이상 유지 (1일 윈도우)
- 자동 스캔 오류율 SLO: `leak_worker_pipeline_last_auto_error_ratio < 0.3`를 95% 이상 유지 (1일 윈도우)
- 자동 삽입율 관찰 지표: `leak_worker_pipeline_last_auto_insert_ratio`의 7일 추세 하락 감지
- SLO 게이트 메트릭: `leak_worker_slo_overall_met` (1=준수, 0=위반)
- 알림 SLA:
  - production critical: 5분 이내 on-call 확인
  - production warning: 30분 이내 triage
  - staging/local: 영업시간 내 확인
