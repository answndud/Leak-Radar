# Infra

Infrastructure and deployment assets.

## Contents
- `docker-compose.yml`: local Postgres/Redis stack
- `schema.sql`: database schema
- `scripts/run-audit-prune.sh`: audit retention batch wrapper

## Audit Retention Operations

Prerequisite:
- `ADMIN_AUDIT_RETENTION_DAYS` must be set (recommended 90~365)

One-off run:
```bash
ADMIN_AUDIT_RETENTION_DAYS=180 ./infra/scripts/run-audit-prune.sh
```

### Cron Example
Run every day at 03:20:
```cron
20 3 * * * cd /path/to/github_api_leaked && ADMIN_AUDIT_RETENTION_DAYS=180 ./infra/scripts/run-audit-prune.sh >> /var/log/leak-radar-audit-prune.log 2>&1
```

### systemd Timer Example
Service unit (`/etc/systemd/system/leak-radar-audit-prune.service`):
```ini
[Unit]
Description=Leak Radar audit retention prune

[Service]
Type=oneshot
WorkingDirectory=/path/to/github_api_leaked
Environment=ADMIN_AUDIT_RETENTION_DAYS=180
ExecStart=/path/to/github_api_leaked/infra/scripts/run-audit-prune.sh
```

Timer unit (`/etc/systemd/system/leak-radar-audit-prune.timer`):
```ini
[Unit]
Description=Run Leak Radar audit prune daily

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now leak-radar-audit-prune.timer
systemctl list-timers | grep leak-radar-audit-prune
```
