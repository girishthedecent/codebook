import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildTarball, TOP_FOLDER, type TarEntry } from '../../../../tests/helpers/repo.js';
import { readRepoArchive, RepoArchiveError, type ArchiveLimits } from './repo.archive.js';

const LIMITS: ArchiveLimits = {
  maxDownloadBytes: 1024 * 1024,
  maxUnpackedBytes: 1024 * 1024,
  maxEntries: 100,
  maxFileBytes: 10_000,
  maxIndexedTokens: 10_000,
  includeTests: false,
};

function read(entries: TarEntry[], limits: Partial<ArchiveLimits> = {}, chunkSize = 0) {
  return readBuffer(buildTarball(entries), limits, chunkSize);
}

function readBuffer(buffer: Buffer, limits: Partial<ArchiveLimits> = {}, chunkSize = 0) {
  const chunks: Buffer[] = [];
  const size = chunkSize || buffer.length || 1;
  for (let i = 0; i < buffer.length; i += size) chunks.push(buffer.subarray(i, i + size));
  return readRepoArchive(Readable.from(chunks), { ...LIMITS, ...limits });
}

describe('readRepoArchive', () => {
  it('strips the top folder and returns files in path order', async () => {
    const { files, skipped } = await read([
      { path: 'src/b.ts', content: 'export const b = 2;\n' },
      { path: 'README.md', content: '# Widgets\n' },
      { path: 'src', type: 'dir' },
      { path: 'src/a.ts', content: 'export const a = 1;\n' },
    ]);
    expect(files.map((f) => f.path)).toEqual(['README.md', 'src/a.ts', 'src/b.ts']);
    expect(files[0]).toMatchObject({ text: '# Widgets\n', sizeBytes: 10 });
    expect(files[0]!.tokens).toBeGreaterThan(0);
    expect(skipped).toEqual([]);
  });

  it('reads an archive delivered in many small chunks', async () => {
    const { files } = await read(
      [{ path: 'a.ts', content: 'line of code\n'.repeat(250) }],
      {},
      100,
    );
    expect(files).toHaveLength(1);
    expect(files[0]!.text).toHaveLength(3250);
  });

  it('records node_modules once, with the size of everything under it', async () => {
    const { files, skipped } = await read([
      { path: 'node_modules/a/index.js', content: '12345' },
      { path: 'node_modules/b/index.js', content: '1234567' },
      { path: 'a/node_modules/x/node_modules/y.js', content: '123' },
      { path: 'a/node_modules/z.js', content: '12' },
      { path: 'ok.ts', content: 'ok' },
    ]);
    expect(files.map((f) => f.path)).toEqual(['ok.ts']);
    expect(skipped).toEqual([
      { path: 'a/node_modules/', reason: 'dependencies', sizeBytes: 5 },
      { path: 'node_modules/', reason: 'dependencies', sizeBytes: 12 },
    ]);
  });

  it('skips secrets, binaries, links, fifos and oversized files with a reason', async () => {
    const { files, skipped } = await read(
      [
        { path: '.env', content: 'SECRET=1' },
        { path: 'data.txt', content: Buffer.from([65, 0, 66]) },
        { path: 'link', type: 'symlink', linkpath: 'a.ts' },
        { path: 'hard', type: 'hardlink', linkpath: 'a.ts' },
        { path: 'pipe', type: 'fifo' },
        { path: 'big.txt', content: 'x'.repeat(200) },
        { path: 'a.ts', content: 'a' },
      ],
      { maxFileBytes: 100 },
    );
    expect(files.map((f) => f.path)).toEqual(['a.ts']);
    const reasons = Object.fromEntries(skipped.map((s) => [s.path, s.reason]));
    expect(reasons).toEqual({
      '.env': 'secret file',
      'big.txt': 'too large',
      'data.txt': 'binary',
      hard: 'link',
      link: 'link',
      pipe: 'unsupported entry',
    });
  });

  it('skips test files unless includeTests is set', async () => {
    const entries: TarEntry[] = [
      { path: 'a.test.ts', content: 'test' },
      { path: 'tests/b.ts', content: 'test' },
    ];
    const without = await read(entries);
    expect(without.files).toEqual([]);
    expect(without.skipped.map((s) => s.reason)).toEqual(['test', 'test']);

    const withTests = await read(entries, { includeTests: true });
    expect(withTests.files.map((f) => f.path)).toEqual(['a.test.ts', 'tests/b.ts']);
    expect(withTests.skipped).toEqual([]);
  });

  it('does not count skipped files toward the token cap', async () => {
    const big = 'some words here\n'.repeat(2000);
    const { files, skipped } = await read(
      [
        { path: 'node_modules/big.js', content: big },
        { path: 'big.min.js', content: big },
        { path: 'a.ts', content: 'a' },
      ],
      { maxIndexedTokens: 100, maxFileBytes: 100_000 },
    );
    expect(files.map((f) => f.path)).toEqual(['a.ts']);
    expect(skipped).toHaveLength(2);
  });

  it('keeps the last entry when a path appears twice', async () => {
    const kept = await read([
      { path: 'a.ts', content: 'first' },
      { path: 'a.ts', content: 'second' },
    ]);
    expect(kept.files).toMatchObject([{ path: 'a.ts', text: 'second' }]);

    const linked = await read([
      { path: 'a.ts', content: 'first' },
      { path: 'a.ts', type: 'symlink', linkpath: 'b.ts' },
    ]);
    expect(linked.files).toEqual([]);
    expect(linked.skipped).toEqual([{ path: 'a.ts', reason: 'link', sizeBytes: 0 }]);

    const restored = await read([
      { path: 'a.ts', type: 'symlink', linkpath: 'b.ts' },
      { path: 'a.ts', content: 'real' },
    ]);
    expect(restored.files).toMatchObject([{ path: 'a.ts', text: 'real' }]);
    expect(restored.skipped).toEqual([]);
  });

  describe('limits', () => {
    it('rejects more entries than maxEntries, not counting directories', async () => {
      const files: TarEntry[] = [
        { path: 'd1', type: 'dir' },
        { path: 'd2', type: 'dir' },
        { path: 'a.ts', content: 'a' },
        { path: 'b.ts', content: 'b' },
      ];
      await expect(read(files, { maxEntries: 2 })).resolves.toBeDefined();
      const error = await read([...files, { path: 'c.ts', content: 'c' }], {
        maxEntries: 2,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RepoArchiveError);
      expect((error as Error).message).toMatch(/more than 2 files/);
    });

    it('rejects an archive that unpacks to more than maxUnpackedBytes', async () => {
      const error = await read([{ path: 'a.txt', content: 'x'.repeat(3000) }], {
        maxUnpackedBytes: 2048,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RepoArchiveError);
      expect((error as Error).message).toMatch(/unpacks to more than/);
    });

    it('rejects a download larger than maxDownloadBytes', async () => {
      const error = await read([{ path: 'a.txt', content: 'x' }], {
        maxDownloadBytes: 50,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RepoArchiveError);
      expect((error as Error).message).toMatch(/download is larger than/);
    });

    it('rejects more indexed tokens than maxIndexedTokens', async () => {
      const error = await read(
        [
          { path: 'a.txt', content: 'some words here\n'.repeat(500) },
          { path: 'b.txt', content: 'some words here\n'.repeat(500) },
        ],
        { maxIndexedTokens: 100, maxFileBytes: 100_000 },
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RepoArchiveError);
      expect((error as Error).message).toMatch(/more than 100 tokens/);
    });
  });

  describe('unsafe paths', () => {
    it.each([
      ['a parent segment', '../evil.txt', true],
      ['a parent segment below the top folder', `${TOP_FOLDER}/../../x`, true],
      ['an absolute path', '/etc/passwd', true],
      ['a backslash', `${TOP_FOLDER}/dir\\file.txt`, true],
    ])('refuses the archive for %s', async (_name, path, raw) => {
      const error = await read([
        { path: 'ok.ts', content: 'ok' },
        { path, content: 'bad', raw },
      ]).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RepoArchiveError);
      expect((error as Error).message).toBe('The repository archive contains unsafe paths');
    });
  });

  it('calls a truncated or non-gzip archive damaged, without retrying', async () => {
    const buffer = buildTarball([{ path: 'a.ts', content: 'x'.repeat(5000) }]);
    for (const bad of [
      buffer.subarray(0, buffer.length - 20),
      Buffer.from('definitely not a tarball'.repeat(50)),
    ]) {
      const error = await readBuffer(bad).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RepoArchiveError);
      expect((error as Error).message).toBe('The repository archive is damaged');
    }
  });

  it('passes a failed download on as is, so the step is retried', async () => {
    async function* broken() {
      yield buildTarball([{ path: 'a.ts', content: 'x' }]).subarray(0, 100);
      throw new TypeError('terminated');
    }
    const error = await readRepoArchive(broken(), LIMITS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
  });
});
