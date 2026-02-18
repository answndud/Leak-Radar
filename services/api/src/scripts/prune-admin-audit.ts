import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

import { pruneAdminAuditLogs } from "../repositories/admin-audit-repository";
import { purgeDeletedAdminAuditViews } from "../repositories/admin-audit-view-repository";

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

const parseViewRetentionDays = (): number => {
  const raw = process.env.ADMIN_AUDIT_VIEW_DELETE_RETENTION_DAYS;
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
  const viewRetentionDays = parseViewRetentionDays();

  if (retentionDays < 1 && viewRetentionDays < 1) {
    console.log(
      "[audit-prune] skipped (set ADMIN_AUDIT_RETENTION_DAYS or ADMIN_AUDIT_VIEW_DELETE_RETENTION_DAYS)"
    );
    return;
  }

  if (retentionDays > 0) {
    const deletedLogs = await pruneAdminAuditLogs(retentionDays);
    console.log(`[audit-prune] logs retention=${retentionDays}d deleted=${deletedLogs}`);
  }

  if (viewRetentionDays > 0) {
    const deletedViews = await purgeDeletedAdminAuditViews(viewRetentionDays);
    console.log(`[audit-prune] views retention=${viewRetentionDays}d purged=${deletedViews}`);
  }
};

void run();
