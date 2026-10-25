// The scripts a first visit downloads: the entry plus everything index.html preloads. The
// entry file alone undercounts, because the router, query and React code split into
// shared chunks that load with it. Lazy chunks (viewer, graph, study) are not counted.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = 215;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));

const html = await readFile(dist + 'index.html', 'utf8');
const files = [...new Set([...html.matchAll(/\/assets\/([^"']+\.js)/g)].map((m) => m[1]!))];

let bytes = 0;
for (const file of files)
  bytes += gzipSync(await readFile(dist + 'assets/' + file), { level: 9 }).length;

const kb = bytes / 1024;
console.log(
  `first-visit JS: ${kb.toFixed(1)} kB gzipped in ${files.length} files (limit ${LIMIT_KB} kB)`,
);
if (kb > LIMIT_KB) {
  console.error('Over the first-visit budget.');
  process.exit(1);
}
