export type SkipReason =
  | 'dependencies'
  | 'build output'
  | 'lockfile'
  | 'binary'
  | 'generated'
  | 'secret file'
  | 'test'
  | 'changelog'
  | 'too large'
  | 'link'
  | 'unsupported entry';

const DEPENDENCY_DIRS = new Set([
  'node_modules',
  'vendor',
  'bower_components',
  '.venv',
  'venv',
  '__pycache__',
  '.git',
]);
const BUILD_DIRS = new Set(['dist', 'build', 'out', '.next', '.nuxt', 'coverage', 'target']);
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'e2e']);

const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'poetry.lock',
  'Pipfile.lock',
  'Cargo.lock',
  'go.sum',
  'composer.lock',
  'Gemfile.lock',
]);

// svg is left out on purpose: it is text and often worth reading.
const BINARY_EXTENSIONS = new Set(
  (
    'png jpg jpeg gif webp bmp ico tiff psd woff woff2 ttf otf eot zip tar gz tgz bz2 xz 7z rar ' +
    'mp3 mp4 wav ogg webm mov avi flac pdf doc docx xls xlsx ppt pptx ' +
    'wasm so dylib dll exe bin o a class jar war pyc pyo node sqlite db'
  ).split(' '),
);

const ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template']);
const SECRET_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.envrc',
  // ~/.aws/credentials and the like.
  'credentials',
  '.pgpass',
  '.htpasswd',
  '.dockercfg',
]);
// Terraform state and variable files hold provider credentials in plain text.
const SECRET_EXTENSIONS = new Set(
  'pem key p12 pfx jks keystore ppk gpg asc env tfstate tfvars'.split(' '),
);
const SSH_KEY_PREFIXES = ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'];

const TEST_FILE = /\.(test|spec)\.|^test_.*\.py$|_test\.(py|go)$/;
const CHANGELOG_FILE = /^(changelog|changes|history)([._-]|$)/i;

// Beyond this average line length the text is almost certainly minified or generated.
const MAX_AVERAGE_LINE_LENGTH = 500;

/**
 * Why a path is skipped, or null to keep it. When a directory causes the skip, `dir` is the
 * outermost such directory with a trailing slash (e.g. 'packages/a/node_modules/'), so the
 * caller can record it once instead of every file under it.
 */
export function pathSkipReason(
  path: string,
  options: { includeTests: boolean },
): { reason: SkipReason; dir?: string } | null {
  const segments = path.split('/');
  const name = segments.pop() ?? '';

  for (let i = 0; i < segments.length; i++) {
    const reason = directoryReason(segments[i]!, options.includeTests);
    if (reason) return { reason, dir: `${segments.slice(0, i + 1).join('/')}/` };
  }

  const reason = fileReason(name, options.includeTests);
  return reason ? { reason } : null;
}

function directoryReason(name: string, includeTests: boolean): SkipReason | null {
  if (DEPENDENCY_DIRS.has(name)) return 'dependencies';
  if (BUILD_DIRS.has(name)) return 'build output';
  if (!includeTests && TEST_DIRS.has(name)) return 'test';
  return null;
}

function fileReason(name: string, includeTests: boolean): SkipReason | null {
  const lower = name.toLowerCase();
  const extension = extensionOf(lower);

  if (LOCKFILES.has(name)) return 'lockfile';
  if (BINARY_EXTENSIONS.has(extension)) return 'binary';
  // A notebook is JSON, mostly cell outputs (tables, base64 images); as text it would drown
  // the repository's code in noise.
  if (
    lower.endsWith('.min.js') ||
    lower.endsWith('.min.css') ||
    extension === 'map' ||
    extension === 'ipynb'
  ) {
    return 'generated';
  }
  if (isSecretFile(lower, extension)) return 'secret file';
  if (!includeTests && TEST_FILE.test(name)) return 'test';
  if (CHANGELOG_FILE.test(name)) return 'changelog';
  return null;
}

function isSecretFile(lowerName: string, extension: string) {
  if (ENV_TEMPLATES.has(lowerName)) return false;
  return (
    lowerName === '.env' ||
    lowerName.startsWith('.env.') ||
    SECRET_NAMES.has(lowerName) ||
    SECRET_EXTENSIONS.has(extension) ||
    SSH_KEY_PREFIXES.some((prefix) => lowerName.startsWith(prefix)) ||
    /^credentials.*\.json$/.test(lowerName) ||
    lowerName.endsWith('.tfstate.backup')
  );
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1);
}

/** Decodes a kept file, or says why its content can't be indexed. */
export function readText(
  bytes: Uint8Array,
  maxFileBytes: number,
): { text: string } | { reason: SkipReason } {
  if (bytes.length > maxFileBytes) return { reason: 'too large' };
  // Anywhere in the file: Postgres can't store a NUL in text, so one late NUL would fail
  // the whole ingest.
  if (bytes.includes(0)) return { reason: 'binary' };

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { reason: 'binary' };
  }

  const text = decoded
    .replace(new RegExp('^\\uFEFF'), '')
    .replace(/\r\n?/g, '\n')
    // Form feed marks page boundaries later on, so it must not come from a source file.
    .replace(/\f/g, ' ');

  if (text.length / text.split('\n').length > MAX_AVERAGE_LINE_LENGTH) {
    return { reason: 'generated' };
  }
  return { text };
}

const LANGUAGES: Record<string, string[]> = {
  typescript: ['ts', 'mts', 'cts'],
  tsx: ['tsx'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  python: ['py', 'pyi'],
  markdown: ['md', 'mdx', 'markdown'],
  json: ['json', 'jsonc'],
  yaml: ['yaml', 'yml'],
  toml: ['toml'],
  go: ['go'],
  rust: ['rs'],
  java: ['java'],
  kotlin: ['kt', 'kts'],
  ruby: ['rb'],
  php: ['php'],
  c: ['c', 'h'],
  cpp: ['cc', 'cpp', 'cxx', 'hpp', 'hh'],
  csharp: ['cs'],
  swift: ['swift'],
  shell: ['sh', 'bash', 'zsh'],
  sql: ['sql'],
  html: ['html', 'htm'],
  css: ['css', 'scss', 'less'],
  vue: ['vue'],
  svelte: ['svelte'],
  xml: ['xml'],
};

const LANGUAGE_BY_EXTENSION = new Map(
  Object.entries(LANGUAGES).flatMap(([language, extensions]) =>
    extensions.map((extension) => [extension, language] as const),
  ),
);

/** Language name by extension, or null for plain text / unknown. */
export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name === 'Dockerfile') return 'dockerfile';
  if (name === 'Makefile') return 'makefile';
  return LANGUAGE_BY_EXTENSION.get(extensionOf(name.toLowerCase())) ?? null;
}
