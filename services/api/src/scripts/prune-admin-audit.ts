import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

import { pruneAdminAuditLogs } from "../repositories/admin-audit-repository";

dotenvConfig({ path: resolve(__dirname, "../../../../.env") });
dotenvConfig();

const parseRetentionDays = (): number => {
  const raw = process.env.ADMIN_AUDIT_RETENTION_DAYS;
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return 0;
  }
  return parsed;
};

const run = async (): Promise<void> => {
  const retentionDays = parseRetentionDays();
  if (retentionDays < 1) {
    console.log("[audit-prune] skipped (ADMIN_AUDIT_RETENTION_DAYS not set)");
    return;
  }

  const deleted = await pruneAdminAuditLogs(retentionDays);
  console.log(`[audit-prune] retention=${retentionDays}d deleted=${deleted}`);
};

void run();
