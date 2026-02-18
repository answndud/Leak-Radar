import { getPool } from "../db";

export type AdminAuditStatus = "allowed" | "denied" | "failed";

export type AdminAuditEntry = {
  id: string;
  occurredAt: string;
  actorId: string | null;
  role: string;
  action: string;
  status: AdminAuditStatus;
  resource: string;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
};

export type AdminAuditQuery = {
  limit?: number;
  status?: AdminAuditStatus;
  role?: string;
  actorId?: string;
  sinceHours?: number;
  cursor?: string;
};

export type AdminAuditListResult = {
  data: AdminAuditEntry[];
  nextCursor: string | null;
};

const encodeCursor = (occurredAt: string, id: string): string =>
  Buffer.from(`${occurredAt}|${id}`, "utf8").toString("base64url");

const decodeCursor = (cursor: string): { occurredAt: string; id: string } | null => {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    if (separator < 1) {
      return null;
    }
    const occurredAt = decoded.slice(0, separator).trim();
    const id = decoded.slice(separator + 1).trim();
    if (!occurredAt || !id) {
      return null;
    }
    return { occurredAt, id };
  } catch {
    return null;
  }
};

type AdminAuditRow = {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  role: string;
  action: string;
  status: AdminAuditStatus;
  resource: string;
  ip: string | null;
  user_agent: string | null;
  metadata: unknown;
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

export const recordAdminAudit = async (params: {
  actorId?: string | null;
  role: string;
  action: string;
  status: AdminAuditStatus;
  resource: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  const pool = getPool();
  await pool.query(
    `INSERT INTO admin_audit_logs (
      id, actor_id, role, action, status, resource, ip, user_agent, metadata
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb
    )`,
    [
      params.actorId ?? null,
      params.role,
      params.action,
      params.status,
      params.resource,
      params.ip ?? null,
      params.userAgent ?? null,
      JSON.stringify(params.metadata ?? {})
    ]
  );
};

export const listAdminAuditLogs = async (query: AdminAuditQuery = {}): Promise<AdminAuditListResult> => {
  const pool = getPool();
  const safeLimit = Math.min(Math.max(Math.floor(query.limit ?? 100), 1), 500);
  const fetchLimit = safeLimit + 1;
  const whereClauses: string[] = [];
  const values: unknown[] = [];

  if (query.status) {
    values.push(query.status);
    whereClauses.push(`status = $${values.length}`);
  }

  if (query.role) {
    values.push(query.role);
    whereClauses.push(`role = $${values.length}`);
  }

  if (query.actorId) {
    values.push(query.actorId);
    whereClauses.push(`actor_id = $${values.length}`);
  }

  if (query.sinceHours && query.sinceHours > 0) {
    values.push(query.sinceHours);
    whereClauses.push(`occurred_at >= now() - ($${values.length} * interval '1 hour')`);
  }

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) {
    values.push(cursor.occurredAt);
    const occurredAtIndex = values.length;
    values.push(cursor.id);
    const idIndex = values.length;
    whereClauses.push(`(occurred_at, id) < ($${occurredAtIndex}::timestamptz, $${idIndex}::uuid)`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  values.push(fetchLimit);
  const result = await pool.query<AdminAuditRow>(
    `SELECT id, occurred_at::text, actor_id, role, action, status, resource, ip, user_agent, metadata
     FROM admin_audit_logs
     ${whereSql}
     ORDER BY occurred_at DESC, id DESC
     LIMIT $${values.length}`,
    values
  );

  const hasMore = result.rows.length > safeLimit;
  const pageRows = hasMore ? result.rows.slice(0, safeLimit) : result.rows;
  const data = pageRows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    role: row.role,
    action: row.action,
    status: row.status,
    resource: row.resource,
    ip: row.ip,
    userAgent: row.user_agent,
    metadata: toRecord(row.metadata)
  }));

  const last = pageRows[pageRows.length - 1];
  return {
    data,
    nextCursor: hasMore && last ? encodeCursor(last.occurred_at, last.id) : null
  };
};

export const pruneAdminAuditLogs = async (retentionDays: number): Promise<number> => {
  const days = Math.max(Math.floor(retentionDays), 1);
  const pool = getPool();
  const result = await pool.query(
    `DELETE FROM admin_audit_logs
     WHERE occurred_at < now() - ($1 * interval '1 day')`,
    [days]
  );
  return result.rowCount ?? 0;
};
