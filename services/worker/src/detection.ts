import { createHash } from "crypto";
import { AI_PROVIDER_IDS } from "@leak/shared";

type MatchResult = {
  provider: string;
  value: string;
};

type ProviderRule = {
  provider: string;
  regex: RegExp;
  minLength: number;
};

/**
 * 오탐 방지 – 매칭된 값이 실제 비밀 키가 아닌지 확인
 *
 * 걸러내야 하는 것들:
 * - 변수명/placeholder: OPENAI_API_KEY, your-api-key, sk-your-key, <API_KEY>
 * - 설정 참조: ${ANTHROPIC_KEY}, process.env.KEY, os.environ["KEY"]
 * - 주석/문서: "replace with your key", "put your key here"
 * - 반복 문자: sk-aaaaaaaaaaaaaaaaaaaaaaaaa
 * - 예시 값: sk-1234567890abcdef...
 */

/** 실제 키가 아닌 placeholder / 변수명 패턴 */
const PLACEHOLDER_PATTERNS = [
  /^.{0,10}(your|my|test|fake|dummy|example|sample|replace|xxx|placeholder|insert|todo|fixme)/i,
  /^.{0,6}(api[_-]?key|secret[_-]?key|access[_-]?key|token)/i,
  /<[^>]+>/,                 // <YOUR_KEY_HERE>
  /\$\{[^}]+\}/,            // ${ENV_VAR}
  /process\.env/i,           // process.env.OPENAI_KEY
  /os\.environ/i,            // os.environ["KEY"]
  /\{\{[^}]+\}\}/,          // {{API_KEY}}
  /^.{0,4}(0{8,}|1{8,}|a{8,}|x{8,}|#{8,}|\*{8,})/i,  // 반복 문자
];

/** 엔트로피 체크 – 진짜 키는 높은 엔트로피를 가짐 */
const hasLowEntropy = (s: string): boolean => {
  // prefix 제거 후 본문만 확인
  const body = s.replace(/^[a-zA-Z_-]{2,10}[-_]/, "");
  if (body.length < 10) return false;

  const chars = new Set(body);
  // 유니크 문자가 5개 이하면 너무 단순
  if (chars.size <= 5) return true;

  // 같은 문자가 60% 이상 차지하면 의심
  const freq: Record<string, number> = {};
  for (const c of body) {
    freq[c] = (freq[c] ?? 0) + 1;
  }
  const maxFreq = Math.max(...Object.values(freq));
  if (maxFreq / body.length > 0.6) return true;

  return false;
};

/** 줄 전체에서 해당 매칭이 변수 할당의 "키" 쪽인지 확인 (값이 아니라 이름인 경우) */
const isVariableNameNotValue = (line: string, matchValue: string): boolean => {
  const idx = line.indexOf(matchValue);
  if (idx < 0) return false;

  // 매칭 뒤에 = 또는 : 가 있으면 이건 변수명 쪽
  const after = line.slice(idx + matchValue.length, idx + matchValue.length + 5).trim();
  if (/^[=:]/.test(after)) return true;

  // 매칭 앞에 export, const, let, var, def 등이 있고 뒤에 값이 없으면 변수명
  const before = line.slice(Math.max(0, idx - 30), idx).trim();
  if (/(?:export|const|let|var|def|set)\s*$/i.test(before)) return true;

  return false;
};

const isFalsePositive = (line: string, value: string): boolean => {
  // placeholder 패턴 체크
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(value)) return true;
  }

  // 엔트로피 체크
  if (hasLowEntropy(value)) return true;

  // 변수 이름인 경우 (값이 아니라 키 쪽)
  if (isVariableNameNotValue(line, value)) return true;

  // 줄 전체가 주석인 경우 (단, 실제 키가 포함될 수도 있으므로 = 없는 주석만)
  const trimmed = line.trim();
  if (/^(#|\/\/|\/\*|\*|--|;)/.test(trimmed) && !trimmed.includes("=") && !trimmed.includes(":")) {
    // 주석이면서 할당이 없는 줄 → 키가 아닌 설명일 가능성 높음
    // 하지만 실제 키가 주석에 붙여넣기된 경우도 있으므로
    // 긴 랜덤 문자열이면 통과, 짧으면 제외
    const body = value.replace(/^[a-zA-Z_-]{2,12}[-_]/, "");
    if (body.length < 20) return true;
  }

  return false;
};

/**
 * 탐지 패턴 목록 – 정확도를 높이기 위해 정규식을 엄격하게 설계
 *
 * sk- prefix 키 분류 전략:
 * - sk-proj-  → OpenAI (확정)
 * - sk-svcacct- → OpenAI (확정)
 * - sk-ant-  → Anthropic (확정)
 * - sk- + 48자 이상 → OpenAI (높은 확률, OpenAI 키는 보통 51자+)
 * - 줄에 MOONSHOT/moonshot 키워드 있으면 → Kimi
 * - 줄에 DEEPSEEK/deepseek 키워드 있으면 → DeepSeek
 * - 나머지 sk- + 32~47자 → 길이/컨텍스트로 구분 불가시 openai로 기본 분류
 *
 * 제거된 패턴: Heroku UUID, Mailgun key-, 일반 Mistral [a-z]{32}
 */
const PROVIDER_RULES: ProviderRule[] = [
  // ── OpenAI (확정적 prefix) ──
  { provider: "openai", regex: /sk-proj-[a-zA-Z0-9_-]{20,}/g, minLength: 28 },
  { provider: "openai", regex: /sk-svcacct-[a-zA-Z0-9_-]{20,}/g, minLength: 30 },
  // OpenAI 레거시: sk- + 48자 이상 (Kimi/DeepSeek는 보통 32자)
  { provider: "openai", regex: /sk-[a-zA-Z0-9]{48,}/g, minLength: 51 },

  // ── Anthropic (확정적 prefix) ──
  { provider: "anthropic", regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g, minLength: 30 },

  // ── Google (API key) – AIzaSy 고정 prefix + 33자 ──
  { provider: "google", regex: /AIzaSy[0-9A-Za-z\-_]{33}/g, minLength: 39 },

  // ── Grok / xAI ──
  { provider: "grok", regex: /xai-[a-zA-Z0-9]{20,}/g, minLength: 24 },

  // ── Kimi / Moonshot (명시적 prefix) ──
  { provider: "kimi", regex: /msk-[a-zA-Z0-9]{20,}/g, minLength: 24 },

  // ── GLM / Zhipu (id.secret 형식) ──
  { provider: "glm", regex: /[a-f0-9]{32}\.[a-zA-Z0-9]{16,}/g, minLength: 49 },

  // ── Stripe (live secret / restricted) ──
  { provider: "stripe", regex: /sk_live_[0-9a-zA-Z]{24,}/g, minLength: 32 },
  { provider: "stripe", regex: /rk_live_[0-9a-zA-Z]{24,}/g, minLength: 32 },

  // ── AWS (Access Key ID) ──
  { provider: "aws", regex: /AKIA[0-9A-Z]{16}/g, minLength: 20 },
  { provider: "aws", regex: /ASIA[0-9A-Z]{16}/g, minLength: 20 },

  // ── Slack ──
  { provider: "slack", regex: /xox[baprs]-[0-9A-Za-z-]{24,}/g, minLength: 30 },

  // ── SendGrid ──
  { provider: "sendgrid", regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g, minLength: 66 },

  // ── GitHub (PAT, fine-grained PAT) ──
  { provider: "github", regex: /ghp_[A-Za-z0-9]{36}/g, minLength: 40 },
  { provider: "github", regex: /github_pat_[A-Za-z0-9_]{22,}/g, minLength: 30 },
  { provider: "github", regex: /gho_[A-Za-z0-9]{36}/g, minLength: 40 },
  { provider: "github", regex: /ghs_[A-Za-z0-9]{36}/g, minLength: 40 },

  // ── NPM Token ──
  { provider: "npm", regex: /npm_[A-Za-z0-9]{36}/g, minLength: 40 },

  // ── Firebase ──
  { provider: "firebase", regex: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/g, minLength: 152 },

  // ── Supabase ──
  { provider: "supabase", regex: /sbp_[a-f0-9]{40}/g, minLength: 44 },

  // ── Vercel ──
  { provider: "vercel", regex: /vercel_[A-Za-z0-9]{24}/g, minLength: 31 },

  // ── Discord Bot Token ──
  { provider: "discord", regex: /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g, minLength: 59 },
];

/**
 * 컨텍스트 기반 키 탐지 – 변수명 키워드로 provider를 결정
 * 줄에 MOONSHOT, DEEPSEEK, MISTRAL 등 키워드가 있고 sk- 값이 있으면 해당 provider로 분류
 */
type ContextRule = {
  provider: string;
  lineKeywords: RegExp;       // 줄에 이 키워드가 있어야 함
  valueRegex: RegExp;         // 값을 캡처
  minLength: number;
};

const CONTEXT_RULES: ContextRule[] = [
  // MOONSHOT_API_KEY= sk-... 또는 moonshot_key= sk-...
  {
    provider: "kimi",
    lineKeywords: /(?:moonshot|kimi|月之暗面)/i,
    valueRegex: /sk-[a-zA-Z0-9]{20,}/g,
    minLength: 23,
  },
  // DEEPSEEK_API_KEY= sk-...
  {
    provider: "deepseek",
    lineKeywords: /deepseek/i,
    valueRegex: /sk-[a-zA-Z0-9]{20,}/g,
    minLength: 23,
  },
  // MISTRAL_API_KEY= ...
  {
    provider: "mistral",
    lineKeywords: /mistral/i,
    valueRegex: /[=:]\s*["']?([a-zA-Z0-9]{32,})["']?/g,
    minLength: 32,
  },
  // OPENAI_API_KEY= sk-... (명시적 컨텍스트)
  {
    provider: "openai",
    lineKeywords: /openai/i,
    valueRegex: /sk-[a-zA-Z0-9]{20,}/g,
    minLength: 23,
  },
  // ANTHROPIC_API_KEY= sk-ant-... (명시적 컨텍스트, prefix 없어도 잡기)
  {
    provider: "anthropic",
    lineKeywords: /anthropic/i,
    valueRegex: /sk-ant-[a-zA-Z0-9_-]{10,}/g,
    minLength: 20,
  },
  // GOOGLE_API_KEY / GEMINI_API_KEY
  {
    provider: "google",
    lineKeywords: /(?:google|gemini)/i,
    valueRegex: /AIzaSy[0-9A-Za-z\-_]{33}/g,
    minLength: 39,
  },
  // GLM / zhipu context
  {
    provider: "glm",
    lineKeywords: /(?:zhipu|glm|chatglm|智谱)/i,
    valueRegex: /[a-f0-9]{32}\.[a-zA-Z0-9]{16,}/g,
    minLength: 49,
  },
];

/** AI 모델 provider 목록 */
export const AI_PROVIDERS = new Set([
  ...AI_PROVIDER_IDS
]);

/**
 * 한 줄에서 provider 패턴 매칭 + 오탐 필터링.
 * allowedProviders를 지정하면 해당 provider만 결과에 포함.
 *
 * 탐지 순서:
 * 1. 컨텍스트 규칙 – 줄에 provider 키워드가 있으면 해당 provider로 확정
 * 2. 패턴 규칙 – 고유한 prefix로 provider 판별
 * → 이미 컨텍스트로 잡힌 값은 중복 추가하지 않음
 */
export const scanLine = (line: string, allowedProviders?: Set<string>): MatchResult[] => {
  const matches: MatchResult[] = [];
  const seen = new Set<string>();   // "provider:value" 중복 방지
  const seenValues = new Set<string>(); // 값 자체 중복 방지 (다른 provider로 이중 매칭 방지)

  // 1단계: 컨텍스트 기반 탐지 (줄에 키워드가 있을 때)
  for (const rule of CONTEXT_RULES) {
    if (allowedProviders && !allowedProviders.has(rule.provider)) {
      continue;
    }
    if (!rule.lineKeywords.test(line)) {
      continue;
    }

    rule.valueRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.valueRegex.exec(line)) !== null) {
      const value = m[1] ?? m[0];
      if (value.length < rule.minLength) continue;
      if (isFalsePositive(line, value)) continue;

      const key = `${rule.provider}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      seenValues.add(value);
      matches.push({ provider: rule.provider, value });
    }
  }

  // 2단계: prefix 기반 패턴 탐지
  for (const rule of PROVIDER_RULES) {
    if (allowedProviders && !allowedProviders.has(rule.provider)) {
      continue;
    }

    rule.regex.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = rule.regex.exec(line)) !== null) {
      const value = m[1] ?? m[0];
      if (value.length < rule.minLength) continue;

      // 이미 컨텍스트 규칙으로 잡힌 값이면 스킵 (이중 매칭 방지)
      if (seenValues.has(value)) continue;

      // 오탐 필터링
      if (isFalsePositive(line, value)) continue;

      const key = `${rule.provider}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      seenValues.add(value);
      matches.push({ provider: rule.provider, value });
    }
  }

  return matches;
};

/**
 * 비밀 키를 마스킹. 앞 4글자와 뒤 3글자만 노출.
 */
export const redactSecret = (secret: string): string => {
  if (secret.length <= 6) {
    return "***";
  }
  const prefix = secret.slice(0, 4);
  const suffix = secret.slice(-3);
  return `${prefix}***${suffix}`;
};

/**
 * 비밀 키의 글로벌 지문(fingerprint) 생성.
 * 원문 key를 HMAC-like salted hash로 처리해 저장 충돌을 줄입니다.
 *
 * dedup 전략:
 * - 같은 원문 key면 = 같은 유출 → 전체 DB에서 1건만 저장
 * - provider가 달라도 (openai vs anthropic), repo가 달라도 무관
 * - 원문은 저장하지 않고, salt된 해시만 비교에 사용
 */
export const makeKeyFingerprint = (
  _provider: string,
  secret: string,
  _repoFullName?: string
): string => {
  const salt =
    process.env.KEY_FINGERPRINT_SALT ??
    process.env.REDACTION_SALT ??
    "local-dev";
  return createHash("sha256")
    .update(`${salt}:${secret}`)
    .digest("hex");
};
