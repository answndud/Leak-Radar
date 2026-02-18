import type { FastifyReply, FastifyRequest } from "fastify";

const ADMIN_KEY_HEADER = "x-leak-radar-admin-key";
const ADMIN_ID_HEADER = "x-leak-radar-admin-id";

const ALL_ROLES = ["read", "write", "danger", "ops"] as const;

export type AdminRole = (typeof ALL_ROLES)[number];

export type AdminPrincipal = {
  actorId: string | null;
  roles: Set<AdminRole>;
};

type KeyPolicy = {
  key: string;
  roles: Set<AdminRole>;
};

const parseRole = (value: string): AdminRole | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "read" || normalized === "write" || normalized === "danger" || normalized === "ops") {
    return normalized;
  }
  return null;
};

const parseRoleList = (value: string): Set<AdminRole> => {
  const roles = value
    .split("|")
    .map((item) => parseRole(item))
    .filter((item): item is AdminRole => item !== null);

  return new Set(roles);
};

const parsePolicies = (): KeyPolicy[] => {
  const raw = process.env.ADMIN_API_KEYS?.trim();
  if (!raw) {
    const singleKey = process.env.ADMIN_API_KEY?.trim();
    if (!singleKey) {
      return [];
    }
    return [{ key: singleKey, roles: new Set<AdminRole>(ALL_ROLES) }];
  }

  const parsed: KeyPolicy[] = [];
  for (const entry of raw.split(";")) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator < 1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const roleText = trimmed.slice(separator + 1).trim();
    if (!key || !roleText) {
      continue;
    }

    const roles = parseRoleList(roleText);
    if (roles.size === 0) {
      continue;
    }

    parsed.push({ key, roles });
  }

  return parsed;
};

const readHeader = (request: FastifyRequest, headerName: string): string | undefined => {
  const value = request.headers[headerName];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
};

const readActorId = (request: FastifyRequest): string | null => {
  const actor = readHeader(request, ADMIN_ID_HEADER)?.trim();
  return actor && actor.length > 0 ? actor : null;
};

const isAuthConfigured = (): boolean => parsePolicies().length > 0;

export const ensureRole = (
  request: FastifyRequest,
  reply: FastifyReply,
  requiredRole: AdminRole
): AdminPrincipal | null => {
  const policies = parsePolicies();
  if (policies.length === 0) {
    return {
      actorId: readActorId(request),
      roles: new Set<AdminRole>(ALL_ROLES)
    };
  }

  const providedKey = readHeader(request, ADMIN_KEY_HEADER)?.trim();
  if (!providedKey) {
    reply.code(401);
    void reply.send({
      error:
        "관리자 인증이 필요합니다. x-leak-radar-admin-key 헤더를 설정하세요."
    });
    return null;
  }

  const matched = policies.find((policy) => policy.key === providedKey);
  if (!matched) {
    reply.code(401);
    void reply.send({ error: "관리자 인증 키가 유효하지 않습니다." });
    return null;
  }

  if (!matched.roles.has(requiredRole)) {
    reply.code(403);
    void reply.send({
      error: `이 작업에는 '${requiredRole}' 권한이 필요합니다.`
    });
    return null;
  }

  return {
    actorId: readActorId(request),
    roles: matched.roles
  };
};

export const authEnabled = (): boolean => isAuthConfigured();
