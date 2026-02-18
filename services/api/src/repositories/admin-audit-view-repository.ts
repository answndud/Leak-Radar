import { getPool } from "../db";

export type AdminAuditViewFilters = {
  status?: "allowed" | "denied" | "failed";
  role?: "ops" | "read" | "write" | "danger";
  actorId?: string;
  sinceHours?: number;
  sortKey?: "occurredAt" | "status" | "role" | "actorId" | "action" | "resource";
  sortDir?: "asc" | "desc";
  searchQuery?: string;
};

export type AdminAuditView = {
  id: string;
  name: string;
  filters: AdminAuditViewFilters;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminAuditViewRow = {
  id: string;
  name: string;
  filters: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const toFilters = (value: unknown): AdminAuditViewFilters => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as AdminAuditViewFilters;
};

const toView = (row: AdminAuditViewRow): AdminAuditView => ({
  id: row.id,
  name: row.name,
  filters: toFilters(row.filters),
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const listAdminAuditViews = async (): Promise<AdminAuditView[]> => {
  const pool = getPool();
  const result = await pool.query<AdminAuditViewRow>(
    `SELECT id, name, filters, created_by, created_at::text, updated_at::text
     FROM admin_audit_views
     ORDER BY updated_at DESC`
  );
  return result.rows.map(toView);
};

export const createAdminAuditView = async (params: {
  name: string;
  filters: AdminAuditViewFilters;
  createdBy?: string | null;
}): Promise<AdminAuditView> => {
  const pool = getPool();
  const result = await pool.query<AdminAuditViewRow>(
    `INSERT INTO admin_audit_views (
      id, name, filters, created_by
    ) VALUES (
      gen_random_uuid(), $1, $2::jsonb, $3
    )
    RETURNING id, name, filters, created_by, created_at::text, updated_at::text`,
    [params.name, JSON.stringify(params.filters), params.createdBy ?? null]
  );

  return toView(result.rows[0]);
};

export const deleteAdminAuditView = async (id: string): Promise<boolean> => {
  const pool = getPool();
  const result = await pool.query("DELETE FROM admin_audit_views WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
};
