import { describe, expect, it } from 'vitest';
import { parseServerConfig } from './index.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
};

describe('parseServerConfig', () => {
  it('applies defaults', () => {
    const config = parseServerConfig(base);
    expect(config.PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('production');
    expect(config.TRUSTED_ORIGINS).toEqual([]);
    expect(config.LIVE_TESTS).toBe(false);
    expect(config.LOG_TO_FILE).toBe(false);
  });

  it('names the variable that is missing', () => {
    expect(() => parseServerConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects URLs without the right scheme', () => {
    expect(() => parseServerConfig({ ...base, DATABASE_URL: 'localhost:5432/db' })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => parseServerConfig({ ...base, BETTER_AUTH_URL: 'localhost:4000' })).toThrow(
      /BETTER_AUTH_URL/,
    );
    expect(() => parseServerConfig({ ...base, TRUSTED_ORIGINS: 'http://ok.test,nope' })).toThrow(
      /TRUSTED_ORIGINS/,
    );
  });

  it('rejects a bad port', () => {
    expect(() => parseServerConfig({ ...base, PORT: '70000' })).toThrow(/PORT/);
    expect(() => parseServerConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('parses TRUST_PROXY as a flag, a hop count or a proxy list', () => {
    expect(parseServerConfig(base).TRUST_PROXY).toBe(false);
    expect(parseServerConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(parseServerConfig({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(parseServerConfig({ ...base, TRUST_PROXY: 'loopback, 10.0.0.0/8' }).TRUST_PROXY).toBe(
      'loopback, 10.0.0.0/8',
    );
  });

  it('treats empty values as unset', () => {
    const config = parseServerConfig({ ...base, GROQ_API_KEY: '', LOG_TO_FILE: '', PORT: '' });
    expect(config.GROQ_API_KEY).toBeUndefined();
    expect(config.LOG_TO_FILE).toBe(false);
    expect(config.PORT).toBe(4000);
  });

  it('rejects a TRUST_PROXY value Express would choke on', () => {
    expect(() => parseServerConfig({ ...base, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
    expect(() => parseServerConfig({ ...base, TRUST_PROXY: '10.0.0.0/8/1' })).toThrow(
      /TRUST_PROXY/,
    );
    for (const bad of ['10.0.0.0/33', '0.0.0.0/0', '::/0']) {
      expect(() => parseServerConfig({ ...base, TRUST_PROXY: bad })).toThrow(/TRUST_PROXY/);
    }
    expect(parseServerConfig({ ...base, TRUST_PROXY: 'fd00::/8' }).TRUST_PROXY).toBe('fd00::/8');
  });

  it('splits TRUSTED_ORIGINS and parses flags', () => {
    const config = parseServerConfig({
      ...base,
      TRUSTED_ORIGINS: 'http://a.test, http://b.test,',
      S3_FORCE_PATH_STYLE: 'true',
      INNGEST_DEV: '1',
    });
    expect(config.TRUSTED_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.INNGEST_DEV).toBe(true);
  });
});
