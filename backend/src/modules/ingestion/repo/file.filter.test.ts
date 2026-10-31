import { describe, expect, it } from 'vitest';
import { languageOf, pathSkipReason, readText } from './file.filter.js';

const keepTests = { includeTests: true };
const skipTests = { includeTests: false };

function reasonOf(path: string, options = skipTests) {
  return pathSkipReason(path, options)?.reason ?? null;
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe('pathSkipReason', () => {
  it('skips dependency and build directories and reports the directory', () => {
    expect(pathSkipReason('node_modules/left-pad/index.js', skipTests)).toEqual({
      reason: 'dependencies',
      dir: 'node_modules/',
    });
    expect(pathSkipReason('app/dist/main.js', skipTests)).toEqual({
      reason: 'build output',
      dir: 'app/dist/',
    });
    expect(reasonOf('.git/config')).toBe('dependencies');
    expect(reasonOf('web/.next/cache.js')).toBe('build output');
  });

  it('reports the outermost matching directory', () => {
    expect(pathSkipReason('a/node_modules/b/node_modules/x.js', skipTests)?.dir).toBe(
      'a/node_modules/',
    );
    expect(pathSkipReason('a/dist/node_modules/x.js', skipTests)).toEqual({
      reason: 'build output',
      dir: 'a/dist/',
    });
  });

  it('keeps a file that only shares its name with a skipped directory', () => {
    expect(reasonOf('src/build.ts')).toBeNull();
    expect(reasonOf('src/vendor.ts')).toBeNull();
  });

  it('skips test directories and files unless tests are included', () => {
    expect(pathSkipReason('src/__tests__/a.ts', skipTests)).toEqual({
      reason: 'test',
      dir: 'src/__tests__/',
    });
    expect(reasonOf('e2e/login.ts')).toBe('test');
    for (const path of ['a.test.ts', 'a.spec.js', 'test_a.py', 'a_test.py', 'pkg/a_test.go']) {
      expect(reasonOf(path)).toBe('test');
    }
    expect(reasonOf('tests/a.ts', keepTests)).toBeNull();
    expect(reasonOf('src/a.test.ts', keepTests)).toBeNull();
    expect(reasonOf('src/test-utils.ts')).toBeNull();
    expect(reasonOf('src/latest.py')).toBeNull();
  });

  it('skips lockfiles by exact name', () => {
    for (const name of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'go.sum']) {
      expect(reasonOf(`x/${name}`)).toBe('lockfile');
    }
    expect(reasonOf('package.json')).toBeNull();
  });

  it('skips binaries by extension, ignoring case, but keeps svg', () => {
    for (const path of ['a.png', 'LOGO.PNG', 'f.woff2', 'a.tgz', 'a.mp4', 'a.pdf', 'a.wasm']) {
      expect(reasonOf(path)).toBe('binary');
    }
    expect(reasonOf('a/b.sqlite')).toBe('binary');
    expect(reasonOf('icon.svg')).toBeNull();
  });

  it('skips generated files', () => {
    for (const path of ['a.min.js', 'a.min.css', 'bundle.js.map', 'notebooks/scaling_laws.ipynb']) {
      expect(reasonOf(path)).toBe('generated');
    }
    expect(reasonOf('admin.js')).toBeNull();
  });

  it('skips secret files but keeps env templates', () => {
    const secrets = [
      '.env',
      '.env.local',
      'api/.env.production',
      'server.pem',
      'tls.key',
      'id_rsa',
      'id_rsa.pub',
      'id_ed25519',
      'a.p12',
      'a.pfx',
      'a.jks',
      'a.keystore',
      'credentials.json',
      'credentials-prod.json',
      '.npmrc',
      '.pypirc',
      '.netrc',
      '.git-credentials',
    ];
    for (const path of secrets) expect(reasonOf(path)).toBe('secret file');
    for (const path of ['.env.example', '.env.sample', '.env.template', 'env.ts']) {
      expect(reasonOf(path)).toBeNull();
    }
    expect(reasonOf('credentials.ts')).toBeNull();
  });

  it('skips changelogs by base name', () => {
    for (const path of [
      'CHANGELOG.md',
      'History.md',
      'CHANGES',
      'changelog-2023.md',
      'a/HISTORY',
    ]) {
      expect(reasonOf(path)).toBe('changelog');
    }
    expect(reasonOf('src/historyService.ts')).toBeNull();
    expect(reasonOf('changesets.ts')).toBeNull();
  });

  it('keeps ordinary source files', () => {
    expect(reasonOf('src/index.ts')).toBeNull();
    expect(reasonOf('README.md')).toBeNull();
  });
});

describe('readText', () => {
  it('rejects files over the size limit', () => {
    expect(readText(bytes('hello'), 4)).toEqual({ reason: 'too large' });
    expect(readText(bytes('hello'), 5)).toEqual({ text: 'hello' });
  });

  it('treats a NUL byte near the start as binary', () => {
    expect(readText(new Uint8Array([104, 105, 0, 106]), 100)).toEqual({ reason: 'binary' });
  });

  it('treats invalid UTF-8 as binary', () => {
    expect(readText(new Uint8Array([0xc3, 0x28]), 100)).toEqual({ reason: 'binary' });
  });

  it('strips the BOM and normalizes line endings and form feeds', () => {
    const result = readText(bytes('﻿one\r\ntwo\rthree\fstill three\n'), 1000);
    expect(result).toEqual({ text: 'one\ntwo\nthree still three\n' });
  });

  it('flags minified single-line content as generated', () => {
    expect(readText(bytes(`var a=${'x+'.repeat(400)}1;`), 10_000)).toEqual({
      reason: 'generated',
    });
  });

  it('keeps normal multi-line code', () => {
    const code = 'export function add(a: number, b: number) {\n  return a + b;\n}\n';
    expect(readText(bytes(code), 1000)).toEqual({ text: code });
  });
});

describe('languageOf', () => {
  it('maps extensions to languages', () => {
    expect(languageOf('src/a.ts')).toBe('typescript');
    expect(languageOf('src/a.tsx')).toBe('tsx');
    expect(languageOf('a.MJS')).toBe('javascript');
    expect(languageOf('a/b.py')).toBe('python');
    expect(languageOf('README.md')).toBe('markdown');
    expect(languageOf('a.hpp')).toBe('cpp');
    expect(languageOf('a.h')).toBe('c');
    expect(languageOf('run.sh')).toBe('shell');
    expect(languageOf('styles.scss')).toBe('css');
  });

  it('knows Dockerfile and Makefile by name', () => {
    expect(languageOf('Dockerfile')).toBe('dockerfile');
    expect(languageOf('svc/Makefile')).toBe('makefile');
  });

  it('returns null for plain text and unknown files', () => {
    expect(languageOf('notes.txt')).toBeNull();
    expect(languageOf('LICENSE')).toBeNull();
    expect(languageOf('dir.ts/file')).toBeNull();
  });

  it('skips more files that hold credentials', () => {
    for (const path of [
      'prod.env',
      '.envrc',
      '.aws/credentials',
      'infra/terraform.tfstate',
      'infra/terraform.tfstate.backup',
      'infra/prod.tfvars',
      '.pgpass',
      '.htpasswd',
      'keys/server.ppk',
    ]) {
      expect(pathSkipReason(path, { includeTests: false }), path).toEqual({
        reason: 'secret file',
      });
    }
  });

  it('calls a file with a NUL byte anywhere binary', () => {
    const bytes = new TextEncoder().encode(`${'text line\n'.repeat(1_000)}\0tail`);
    expect(bytes.indexOf(0)).toBeGreaterThan(8_192);
    expect(readText(bytes, 500_000)).toEqual({ reason: 'binary' });
  });
});
