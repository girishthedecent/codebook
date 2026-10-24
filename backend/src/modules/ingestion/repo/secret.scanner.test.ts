import { describe, expect, it } from 'vitest';
import { redactSecrets } from './secret.scanner.js';

// Samples are joined from pieces so no key-shaped string sits in the repository.
const AWS_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE';
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCY' + 'EXAMPLEKEY';
const GITHUB_TOKEN = 'ghp_' + 'a1B2c3D4e5'.repeat(3) + 'a1B2c3';
const GITHUB_PAT = 'github_pat_' + 'a1B2c3D4e5'.repeat(8) + 'xy';
const SLACK_TOKEN = 'xoxb-' + '1234567890-abcdefghij';
const STRIPE_KEY = 'sk_live_' + 'a1B2c3D4e5F6g7H8';
const GOOGLE_KEY = 'AIza' + 'Sy' + 'a1B2c3D4e5'.repeat(3) + 'xyz';
const ANTHROPIC_KEY = 'sk-ant-' + 'api03-' + 'a1B2c3D4e5'.repeat(2);
const OPENAI_KEY = 'sk-' + 'proj-' + 'a1B2c3D4e5'.repeat(2);
const GROQ_KEY = 'gsk_' + 'a1B2c3D4e5'.repeat(4);
const JWT = 'eyJ' + 'hbGciOiJIUzI1' + '.eyJ' + 'zdWIiOiIxMjM0' + '.' + 'abcdEFGH12';
const SECRET_VALUE = 'Zx9fQ2mK7pLw4RtV';

describe('redactSecrets', () => {
  it.each([
    ['aws-access-key', AWS_KEY],
    ['github-token', GITHUB_TOKEN],
    ['github-token', GITHUB_PAT],
    ['slack-token', SLACK_TOKEN],
    ['stripe-key', STRIPE_KEY],
    ['google-api-key', GOOGLE_KEY],
    ['anthropic-key', ANTHROPIC_KEY],
    ['openai-key', OPENAI_KEY],
    ['groq-key', GROQ_KEY],
    ['jwt', JWT],
  ])('redacts a %s', (rule, sample) => {
    const { text, findings } = redactSecrets(`before ${sample} after`);
    expect(text).toBe(`before [REDACTED:${rule}] after`);
    expect(findings).toEqual([{ rule, count: 1 }]);
  });

  it('redacts an AWS secret key only on a line that mentions aws and secret', () => {
    const input = `aws_secret_access_key = ${AWS_SECRET}\nchecksum ${AWS_SECRET}`;
    const { text, findings } = redactSecrets(input);
    expect(text).toBe(`aws_secret_access_key = [REDACTED:aws-secret-key]\nchecksum ${AWS_SECRET}`);
    expect(findings).toEqual([{ rule: 'aws-secret-key', count: 1 }]);
  });

  it('counts every match of a rule', () => {
    const { text, findings } = redactSecrets(`a ${AWS_KEY}\nb ${AWS_KEY}\nc ${GROQ_KEY}`);
    expect(text).not.toContain(AWS_KEY);
    expect(findings).toEqual([
      { rule: 'aws-access-key', count: 2 },
      { rule: 'groq-key', count: 1 },
    ]);
  });

  it('takes an Anthropic key by its own rule, not the OpenAI one', () => {
    const { findings } = redactSecrets(ANTHROPIC_KEY);
    expect(findings).toEqual([{ rule: 'anthropic-key', count: 1 }]);
  });

  it('keeps the key name and quotes around a redacted value', () => {
    const { text } = redactSecrets(`const apiKey = "${OPENAI_KEY}";`);
    expect(text).toBe('const apiKey = "[REDACTED:openai-key]";');
  });

  it('redacts a private key block but keeps its line breaks', () => {
    const block = [
      '-----BEGIN RSA ' + 'PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA1234567890abcdef',
      'ghijklmnopqrstuvwxyzABCDEFGHIJKL',
      '-----END RSA ' + 'PRIVATE KEY-----',
    ].join('\n');
    const input = `first line\n${block}\nMARKER line\nlast line`;
    const { text, findings } = redactSecrets(input);
    expect(findings).toEqual([{ rule: 'private-key', count: 1 }]);
    expect(text).not.toContain('MIIEow');
    expect(text).toContain('[REDACTED:private-key]');
    expect(text.split('\n')).toHaveLength(input.split('\n').length);
    expect(text.split('\n').indexOf('MARKER line')).toBe(input.split('\n').indexOf('MARKER line'));
  });

  describe('generic secrets', () => {
    it('redacts a quoted JSON value', () => {
      const { text, findings } = redactSecrets(`{ "password": "${SECRET_VALUE}", "user": "bob" }`);
      expect(text).toBe('{ "password": "[REDACTED:generic-secret]", "user": "bob" }');
      expect(findings).toEqual([{ rule: 'generic-secret', count: 1 }]);
    });

    it('redacts an unquoted YAML value', () => {
      const { text } = redactSecrets(`service:\n  api_key: ${SECRET_VALUE}\n  port: 80`);
      expect(text).toBe('service:\n  api_key: [REDACTED:generic-secret]\n  port: 80');
    });

    it('redacts .env style KEY=value and upper-case API_KEY', () => {
      const { text } = redactSecrets(`API_KEY=${SECRET_VALUE}\nDB_PASSWORD=${SECRET_VALUE}`);
      expect(text).toBe('API_KEY=[REDACTED:generic-secret]\nDB_PASSWORD=[REDACTED:generic-secret]');
    });

    it('redacts a single-quoted value and keeps a trailing comma or semicolon', () => {
      expect(redactSecrets(`db_password = '${SECRET_VALUE}'`).text).toBe(
        "db_password = '[REDACTED:generic-secret]'",
      );
      expect(redactSecrets(`apiKey: ${SECRET_VALUE},`).text).toBe(
        'apiKey: [REDACTED:generic-secret],',
      );
    });

    it('leaves a value that an earlier rule already redacted alone', () => {
      const { findings } = redactSecrets(`token: ${GITHUB_TOKEN}`);
      expect(findings).toEqual([{ rule: 'github-token', count: 1 }]);
    });
  });

  describe('false positives', () => {
    it.each([
      'const token = getToken()',
      'password: z.string().min(8)',
      'apiKey: process.env.API_KEY',
      'secret = config.secret',
      'password: ${DATABASE_PASSWORD}',
      'token = os.environ["ACCESS_TOKEN"]',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'id 123e4567-e89b-12d3-a456-426614174000',
      "token: 'your-api-key-here'",
      'password = "password"',
      'A token is split into words before it is embedded.',
    ])('keeps %s', (line) => {
      expect(redactSecrets(line)).toEqual({ text: line, findings: [] });
    });
  });

  it('returns text with nothing to redact unchanged', () => {
    const input = 'export function add(a: number, b: number) {\n  return a + b;\n}\n';
    expect(redactSecrets(input)).toEqual({ text: input, findings: [] });
  });

  it('finds values behind type annotations and before trailing comments', () => {
    const value = 'Zq8' + 'kLp2Vx9mN4qR';
    const cases = [
      `const DB_PASSWORD: string = '${value}';`,
      `    password: str = "${value}"`,
      `POSTGRES_PASSWORD: ${value}  # local only`,
      `api_key=${value} ; prod`,
      `export SECRET_KEY=${value} && ./run`,
    ];
    for (const line of cases) {
      const { text } = redactSecrets(line);
      expect(text, line).toContain('[REDACTED:generic-secret]');
      expect(text, line).not.toContain(value);
    }
    // What follows the value stays.
    expect(redactSecrets(`POSTGRES_PASSWORD: ${value}  # local only`).text).toBe(
      'POSTGRES_PASSWORD: [REDACTED:generic-secret]  # local only',
    );
  });

  it('leaves type declarations and identifiers alone', () => {
    for (const line of [
      'password: string;',
      '  accessToken: AuthorizationHeader',
      'interface Login { password?: string }',
      'token: TokenResponse = await fetchToken()',
    ]) {
      expect(redactSecrets(line, { code: true }).text, line).toBe(line);
    }
  });

  it('takes a letters-only unquoted value for a password in config files only', () => {
    const line = 'PASSWORD=' + 'xKqLpVmN' + 'zRtYwBsD';
    expect(redactSecrets(line).text).toBe('PASSWORD=[REDACTED:generic-secret]');
    expect(redactSecrets(line, { code: true }).text).toBe(line);
  });

  it('stays fast on a very long run of name characters', () => {
    const line = 'a'.repeat(300_000);
    const started = performance.now();
    redactSecrets(`${line}\npassword = x`);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('redacts human passwords that a key names, but not settings next to them', () => {
    for (const line of [
      'DB_PASSWORD=hunter2hunter',
      'password: "SuperSecret123"',
      'DB_PASS=' + 'Xk9#mQ2!',
      'SECRET_KEY="/k3J9' + 'qW+e7Zr2Lx="',
    ]) {
      expect(redactSecrets(line).text, line).toContain('[REDACTED:generic-secret]');
    }
    for (const line of [
      "tokenUrl: 'https://oauth2.example.com/token'",
      "secretName: 'app-secrets'",
      "passwordPolicy: './policy.json'",
      "token: '<your token>'",
      'api_key: changeme',
      'TOKEN_ENV = "GITHUB_TOKEN"',
      "keyFile: './certs/server.json'",
    ]) {
      expect(redactSecrets(line).text, line).toBe(line);
    }
  });

  it("checks a YAML key on the line after a key that isn't a secret", () => {
    const yaml = 'secrets:\n  database_password: ' + 'Pr0dDbP4ss!2024x' + '\n';
    expect(redactSecrets(yaml).text).toBe(
      'secrets:\n  database_password: [REDACTED:generic-secret]\n',
    );
  });

  it('redacts passwords inside URLs but not templates', () => {
    const url = 'DATABASE_URL=postgres://admin:' + 'S3cr3tPw' + '@db:5432/app';
    expect(redactSecrets(url).text).toBe(
      'DATABASE_URL=postgres://admin:[REDACTED:url-password]@db:5432/app',
    );
    const template = 'MONGO_URI=mongodb://app:${MONGO_PASSWORD}@mongo:27017';
    expect(redactSecrets(template).text).toBe(template);
  });

  it('redacts PGP private key blocks', () => {
    const block = [
      '-----BEGIN PGP ' + 'PRIVATE KEY BLOCK-----',
      'lQOYBF0abc',
      '-----END PGP ' + 'PRIVATE KEY BLOCK-----',
    ].join('\n');
    const { text } = redactSecrets(`a\n${block}\nb`);
    expect(text).toBe('a\n[REDACTED:private-key]\n\n\nb');
  });

  it('stays fast on many key headers without an end', () => {
    const text = Array.from({ length: 16_000 }, () => '-----BEGIN RSA ' + 'PRIVATE KEY-----').join(
      '\n',
    );
    const started = performance.now();
    expect(redactSecrets(text).text).toBe(text);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
