// Repository tarballs built by hand, so tests can include entries that tar tools refuse to create.
import { gzipSync } from 'node:zlib';

export type TarEntry = {
  path: string;
  // Defaults to 'file'.
  type?: 'file' | 'dir' | 'symlink' | 'hardlink' | 'fifo';
  content?: string | Buffer; // files only
  linkpath?: string; // links only
  // Write `path` as given instead of under the top folder (for absolute or ../ paths).
  raw?: boolean;
};

export const TOP_FOLDER = 'acme-widgets-abc1234';

// Fake credentials, assembled at runtime so this repository never holds a key-shaped string.
export const FIXTURE_SECRETS = {
  awsKey: 'AKIA' + 'Q7XW3NB5R2KD9MZL',
  password: 'xP9#' + 'vL2$qR7!mT4w',
  envSecret: 'env-only-' + 'Zk38Qw91Lp',
};

// A method long enough to be a child of its own (~250 tokens).
function method(name: string, lines = 12) {
  const body = Array.from(
    { length: lines },
    (_, i) => `    const step${i} = await this.store.lookup(user, '${name}', ${i});`,
  );
  return `  async ${name}(user: string) {\n${body.join('\n')}\n    return step0;\n  }`;
}

/** Files of the fixture repository that are kept and indexed (path → content). */
export const FIXTURE_FILES: Record<string, string> = {
  'README.md': [
    '# Widgets',
    'Widgets is a small service that signs users in and keeps their sessions.',
    '## Setup',
    'Run the server and point it at a session store before signing anyone in.',
    '```sh',
    '# not a heading, a shell comment',
    'npm start',
    '```',
    '',
  ].join('\n'),
  'src/auth/service.ts': [
    "import { Store } from '../store';",
    '',
    '/** Signs users in and out. */',
    'export class AuthService {',
    '  constructor(private store: Store) {}',
    '',
    method('login'),
    '',
    method('logout'),
    '}',
    '',
    'export const hashPassword = (value: string) => value.split("").reverse().join("");',
    '',
  ].join('\n'),
  'src/util.py': [
    'import os',
    '',
    'def read_config(path):',
    '    """Reads the settings file."""',
    '    with open(path) as handle:',
    '        return handle.read()',
    '',
    'class Cache:',
    '    def get(self, key):',
    '        return os.environ.get(key)',
    '',
  ].join('\n'),
  'config/settings.json': JSON.stringify(
    {
      region: 'eu-west-1',
      accessKeyId: FIXTURE_SECRETS.awsKey,
      password: FIXTURE_SECRETS.password,
    },
    null,
    2,
  ),
};

/** The fixture repository with every kind of file the filter leaves out. */
export function fixtureRepoEntries(files: Record<string, string> = FIXTURE_FILES): TarEntry[] {
  return [
    ...Object.entries(files).map(([path, content]) => ({ path, content })),
    { path: '.env', content: `DB_PASSWORD=${FIXTURE_SECRETS.envSecret}\n` },
    { path: 'node_modules/left-pad/index.js', content: 'module.exports = () => 1;\n' },
    { path: 'node_modules/left-pad/package.json', content: '{"name":"left-pad"}\n' },
    { path: 'assets/logo.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) },
    { path: 'test/auth.test.ts', content: "it('signs in', () => {});\n" },
    { path: 'CHANGELOG.md', content: '# 1.0.0\nFirst release.\n' },
    { path: 'docs/link.md', type: 'symlink', linkpath: '../README.md' },
  ];
}

const BLOCK = 512;

const TYPEFLAGS = { file: '0', hardlink: '1', symlink: '2', fifo: '6', dir: '5' } as const;

/** A gzipped tarball like GitHub's: a pax global header, then every entry under TOP_FOLDER/. */
export function buildTarball(entries: TarEntry[]): Buffer {
  const commit = 'abc1234'.padEnd(40, '0');
  const parts: Buffer[] = [
    entryBlocks({ name: 'pax_global_header', typeflag: 'g', body: paxRecord('comment', commit) }),
    entryBlocks({ name: `${TOP_FOLDER}/`, typeflag: TYPEFLAGS.dir, mode: '0000755' }),
  ];

  for (const entry of entries) {
    const type = entry.type ?? 'file';
    let name = entry.raw ? entry.path : `${TOP_FOLDER}/${entry.path}`;
    if (type === 'dir' && !name.endsWith('/')) name += '/';
    parts.push(
      entryBlocks({
        name,
        typeflag: TYPEFLAGS[type],
        mode: type === 'dir' ? '0000755' : '0000644',
        linkname: entry.linkpath,
        body: type === 'file' ? Buffer.from(entry.content ?? '') : undefined,
      }),
    );
  }

  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts));
}

// One pax record: "<length> <key>=<value>\n", where the length counts its own digits too.
function paxRecord(key: string, value: string) {
  const rest = ` ${key}=${value}\n`;
  const restLength = Buffer.byteLength(rest);
  let length = restLength + 1;
  while (String(length).length + restLength !== length) length++;
  return Buffer.from(`${length}${rest}`);
}

type EntrySpec = {
  name: string;
  typeflag: string;
  mode?: string;
  linkname?: string;
  body?: Buffer;
};

// Header block followed by the body padded to a whole number of blocks.
function entryBlocks({ name, typeflag, mode = '0000644', linkname = '', body }: EntrySpec) {
  const size = body?.length ?? 0;
  const header = Buffer.alloc(BLOCK);
  const { prefix, base } = splitName(name);

  put(header, 0, 100, base);
  put(header, 100, 8, `${mode}\0`);
  put(header, 108, 8, '0000000\0'); // uid
  put(header, 116, 8, '0000000\0'); // gid
  put(header, 124, 12, `${size.toString(8).padStart(11, '0')}\0`);
  put(header, 136, 12, '00000000000\0'); // mtime
  put(header, 148, 8, '        '); // checksum, counted as spaces
  put(header, 156, 1, typeflag);
  put(header, 157, 100, linkname);
  put(header, 257, 8, 'ustar\x0000');
  put(header, 329, 8, '0000000\0'); // devmajor
  put(header, 337, 8, '0000000\0'); // devminor
  put(header, 345, 155, prefix);

  let sum = 0;
  for (const byte of header) sum += byte;
  put(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);

  if (!body || size === 0) return header;
  const padding = Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
  return Buffer.concat([header, body, padding]);
}

// Writes text into a fixed-width field; throws rather than silently cutting it off.
function put(header: Buffer, offset: number, width: number, text: string) {
  if (Buffer.byteLength(text) > width) throw new Error(`Tar field too long: ${text}`);
  header.write(text, offset, 'utf8');
}

// Names over 100 bytes are split at a '/' into prefix (up to 155) and name (up to 100).
function splitName(name: string) {
  if (Buffer.byteLength(name) <= 100) return { prefix: '', base: name };
  for (let i = name.length - 2; i > 0; i--) {
    if (name[i] !== '/') continue;
    const prefix = name.slice(0, i);
    const base = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(base) <= 100) {
      return { prefix, base };
    }
  }
  throw new Error(`Tar path cannot be split into prefix and name: ${name}`);
}
