import { MANUAL_PROVIDER_IDS } from "@leak/shared";
import { buildQueriesForProviders } from "./config";

export type ParsedScanQuery = {
  queries: string[];
  allowedProviders?: Set<string>;
  selectedProviders?: string[];
};

const VALID_PROVIDERS = new Set(MANUAL_PROVIDER_IDS);

export const parseScanQueryInput = (query: string | null): ParsedScanQuery => {
  if (!query) {
    return { queries: [] };
  }

  try {
    const parsed = JSON.parse(query) as { providers?: unknown };
    if (Array.isArray(parsed.providers) && parsed.providers.length > 0) {
      const providers = parsed.providers
        .filter((provider): provider is string => typeof provider === "string")
        .map((provider) => provider.trim().toLowerCase())
        .filter((provider) => VALID_PROVIDERS.has(provider))
        .filter((provider) => provider.length > 0);

      if (providers.length === 0) {
        return { queries: [] };
      }

      const dedupedProviders = [...new Set(providers)];
      const queries = buildQueriesForProviders(dedupedProviders);
      return {
        queries,
        allowedProviders: new Set(dedupedProviders),
        selectedProviders: dedupedProviders
      };
    }
  } catch {
    // JSON이 아닌 일반 문자열
  }

  return { queries: [query] };
};
