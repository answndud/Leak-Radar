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
  category: string;
  description: string | null;
  isPinned: boolean;
  filters: AdminAuditViewFilters;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type AdminAuditViewRow = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  is_pinned: boolean;
  filters: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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
  category: row.category,
  description: row.description,
  isPinned: row.is_pinned,
  filters: toFilters(row.filters),
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at
});

export const listAdminAuditViews = async (options?: { includeDeleted?: boolean }): Promise<AdminAuditView[]> => {
  const pool = getPool();
  const includeDeleted = options?.includeDeleted === true;
  const result = await pool.query<AdminAuditViewRow>(
    `SELECT id, name, category, description, is_pinned, filters, created_by,
            created_at::text, updated_at::text, deleted_at::text
     FROM admin_audit_views
     ${includeDeleted ? "" : "WHERE deleted_at IS NULL"}
     ORDER BY is_pinned DESC, updated_at DESC`
  );
  return result.rows.map(toView);
};

export const createAdminAuditView = async (params: {
  name: string;
  category: string;
  description?: string | null;
  isPinned?: boolean;
  filters: AdminAuditViewFilters;
  createdBy?: string | null;
}): Promise<AdminAuditView> => {
  const pool = getPool();
  const result = await pool.query<AdminAuditViewRow>(
    `INSERT INTO admin_audit_views (
      id, name, category, description, is_pinned, filters, created_by
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6
    )
    RETURNING id, name, category, description, is_pinned, filters, created_by,
              created_at::text, updated_at::text, deleted_at::text`,
    [
      params.name,
      params.category,
      params.description ?? null,
      params.isPinned === true,
      JSON.stringify(params.filters),
      params.createdBy ?? null
    ]
  );

  return toView(result.rows[0]);
};

export const getAdminAuditViewById = async (id: string): Promise<AdminAuditView | null> => {
  const pool = getPool();
  const result = await pool.query<AdminAuditViewRow>(
    `SELECT id, name, category, description, is_pinned, filters, created_by,
            created_at::text, updated_at::text, deleted_at::text
     FROM admin_audit_views
     WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }
  return toView(result.rows[0]);
};

export const deleteAdminAuditView = async (id: string): Promise<boolean> => {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE admin_audit_views
     SET deleted_at = now(),
         updated_at = now()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
};

export const restoreAdminAuditView = async (id: string): Promise<boolean> => {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE admin_audit_views
     SET deleted_at = NULL,
         updated_at = now()
     WHERE id = $1
       AND deleted_at IS NOT NULL`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
};

export const purgeDeletedAdminAuditViews = async (retentionDays: number): Promise<number> => {
  const days = Math.max(Math.floor(retentionDays), 1);
  const pool = getPool();
  const result = await pool.query(
    `DELETE FROM admin_audit_views
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - ($1 * interval '1 day')`,
    [days]
  );
  return result.rowCount ?? 0;
};

export const updateAdminAuditView = async (params: {
  id: string;
  name: string;
  category: string;
  description?: string | null;
  isPinned?: boolean;
  filters: AdminAuditViewFilters;
}): Promise<AdminAuditView | null> => {
  const pool = getPool();
  const result = await pool.query<AdminAuditViewRow>(
    `UPDATE admin_audit_views
     SET name = $2,
         category = $3,
         description = $4,
         is_pinned = $5,
         filters = $6::jsonb,
         updated_at = now()
     WHERE id = $1
       AND deleted_at IS NULL
     RETURNING id, name, category, description, is_pinned, filters, created_by,
               created_at::text, updated_at::text, deleted_at::text`,
    [
      params.id,
      params.name,
      params.category,
      params.description ?? null,
      params.isPinned === true,
      JSON.stringify(params.filters)
    ]
  );

  if (result.rows.length === 0) {
    return null;
  }
  return toView(result.rows[0]);
};
