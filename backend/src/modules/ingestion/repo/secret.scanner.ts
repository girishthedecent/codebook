export type SecretFinding = { rule: string; count: number };

type Rule = { rule: string; pattern: RegExp };

// Specific token formats first, so the generic rule only sees what is left. Anthropic keys
// also fit the OpenAI pattern and must be taken by their own rule.
const TOKEN_RULES: Rule[] = [
  { rule: 'aws-access-key', pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { rule: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { rule: 'github-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
  { rule: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { rule: 'stripe-key', pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g },
  { rule: 'google-api-key', pattern: /\bAIza[0-9A-Za-z\-_]{35}/g },
  { rule: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { rule: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { rule: 'groq-key', pattern: /\bgsk_[A-Za-z0-9]{40,}/g },
];

const AWS_SECRET_VALUE = /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g;
// PEM and PGP private keys (`… PRIVATE KEY-----`, `… PRIVATE KEY BLOCK-----`).
const KEY_BEGIN = /-----BEGIN [A-Z ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;
const KEY_END = /-----END [A-Z ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;
// Credentials inside a URL: scheme://user:PASSWORD@host (database URLs, broker URIs).
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@'"]{1,100}:)([^\s@/'"]{1,200})@/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

// Group 1 is the key and separator, which stay; it may include a type annotation
// (`password: str = …`, `DB_PASSWORD: string = …`). The value is a quoted string (group 2 is
// the quote, group 3 the content) or an unquoted word up to the next space (group 4), so a
// trailing comment doesn't hide it. Name parts are bounded to keep matching linear, and
// spacing never crosses a line, so one key's match can't swallow the next line's key.
const GENERIC_SECRET =
  /(["']?[\w.-]{0,64}(?:password|passwd|pass(?![a-z])|pwd|secret|token|api_?key|access_?key|credentials?)[\w.-]{0,64}["']?\??(?:[ \t]*:[ \t]*[\w.<>[\]|?]+(?=[ \t]*=))?[ \t]*[:=][ \t]*)(?:(["'`])(.*?)\2|([^\s'"`]+))/gi;
const MIN_SECRET_LENGTH = 8;
// Low on purpose: the key already says it is a secret, and human passwords
// ("hunter2hunter", "SuperSecret123") score well under the 3.5 that random tokens reach.
const MIN_ENTROPY = 2.5;
const PLACEHOLDER =
  /your|example|sample|change.?me|placeholder|dummy|xxx|\*\*\*|^<.*>$|^(password|secret|token)$/i;
const DOTTED_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

/**
 * Replaces secret values with `[REDACTED:<rule>]`. In source code (`code`), an unquoted
 * value without a digit is taken for an identifier (`accessToken: AuthHeader`); in config
 * files it can be a password.
 */
export function redactSecrets(
  text: string,
  { code = false } = {},
): { text: string; findings: SecretFinding[] } {
  const counts = new Map<string, number>();
  const mark = (rule: string) => {
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
    return `[REDACTED:${rule}]`;
  };

  let result = text;
  for (const { rule, pattern } of TOKEN_RULES) {
    result = result.replace(pattern, () => mark(rule));
  }

  // The secret key has no format of its own, so only lines that name it are searched.
  result = result.replace(/^.*$/gm, (line) =>
    /aws/i.test(line) && /secret/i.test(line)
      ? line.replace(AWS_SECRET_VALUE, () => mark('aws-secret-key'))
      : line,
  );

  result = redactKeyBlocks(result, () => mark('private-key'));

  result = result.replace(URL_PASSWORD, (match, prefix: string, password: string) =>
    // Templates (`${DB_PASSWORD}`, `<password>`) aren't secrets.
    /^[$<{%]/.test(password) || PLACEHOLDER.test(password)
      ? match
      : `${prefix}${mark('url-password')}@`,
  );

  result = result.replace(JWT, () => mark('jwt'));

  result = result.replace(
    GENERIC_SECRET,
    (match, key: string, quote: string | undefined, quoted: string | undefined, rest = '') => {
      if (quote !== undefined) {
        return looksSecret(quoted!, { quoted: true, code })
          ? `${key}${quote}${mark('generic-secret')}${quote}`
          : match;
      }
      const value = rest.replace(/[,;]+$/, '');
      if (!looksSecret(value, { quoted: false, code })) return match;
      return key + mark('generic-secret') + rest.slice(value.length);
    },
  );

  const findings = [...counts].map(([rule, count]) => ({ rule, count }));
  return { text: result, findings };
}

// Private key blocks, found by hand: a regex with a lazy body rescans to the end of the
// text for every BEGIN without an END. Line breaks stay so later lines keep their numbers.
function redactKeyBlocks(text: string, replacement: () => string) {
  let result = '';
  let from = 0;
  for (const begin of text.matchAll(KEY_BEGIN)) {
    if (begin.index < from) continue;
    KEY_END.lastIndex = begin.index;
    const end = KEY_END.exec(text);
    // No END after this BEGIN means none after any later one either.
    if (!end) break;
    const blockEnd = end.index + end[0].length;
    const lineBreaks = text.slice(begin.index, blockEnd).split('\n').length - 1;
    result += text.slice(from, begin.index) + replacement() + '\n'.repeat(lineBreaks);
    from = blockEnd;
  }
  return result + text.slice(from);
}

function looksSecret(value: string, { quoted, code }: { quoted: boolean; code: boolean }) {
  if (value.startsWith('[REDACTED:')) return false;
  if (value.length < MIN_SECRET_LENGTH || /\s/.test(value)) return false;
  if (PLACEHOLDER.test(value)) return false;
  // URLs, paths (`tokenUrl: 'https://…/token'`, `keyFile: './keys.json'`), plain lowercase
  // words (`secretName: 'app-secrets'`) and environment variable names
  // (`TOKEN_ENV = "GITHUB_TOKEN"`) are settings, not secrets. A path has no + or =, which
  // keeps base64 values that start with a slash.
  if (/^https?:\/\//.test(value) || /^\.{0,2}\/[\w./-]*$/.test(value)) return false;
  if (/^[a-z_.-]+$/.test(value) || /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(value)) return false;
  // Unquoted values are often code (calls, env lookups, templates), not literals.
  if (!quoted && (/[()$[\]{}]/.test(value) || DOTTED_PATH.test(value))) return false;
  if (!quoted && code && !/\d/.test(value)) return false;
  return entropy(value) > MIN_ENTROPY;
}

// Shannon entropy in bits per character.
function entropy(value: string) {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const share = count / value.length;
    bits -= share * Math.log2(share);
  }
  return bits;
}
