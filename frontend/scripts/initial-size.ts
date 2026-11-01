// What a first visit downloads, per way in: `/` loads the landing entry alone, any other address
// loads the app. Each is its entry plus the shared chunks it imports statically (the entry file
// alone undercounts). Lazy chunks (viewer, graph, study) are not counted. The larger of the two
// has to fit the budget.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = 150;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));

type Chunk = { file: string; src?: string; isEntry?: boolean; imports?: string[] };
const manifest = JSON.parse(await readFile(dist + '.vite/manifest.json', 'utf8')) as Record<
  string,
  Chunk
>;

function staticFiles(entry: Chunk): string[] {
  const files = new Set([entry.file]);
  const walk = (chunk: Chunk) => {
    for (const key of chunk.imports ?? []) {
      const dep = manifest[key]!;
      if (files.has(dep.file)) continue;
      files.add(dep.file);
      walk(dep);
    }
  };
  walk(entry);
  return [...files];
}

const entries: Array<[string, string]> = [
  ['app', 'index.html'],
  ['landing', 'src/landing.tsx'],
];

let worst = 0;
for (const [name, src] of entries) {
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry && chunk.src === src);
  if (!entry) throw new Error(`The build has no ${name} entry`);
  const files = staticFiles(entry);
  let bytes = 0;
  for (const file of files) bytes += gzipSync(await readFile(dist + file), { level: 9 }).length;
  const kb = bytes / 1024;
  worst = Math.max(worst, kb);
  console.log(`first-visit JS, ${name}: ${kb.toFixed(1)} kB gzipped in ${files.length} files`);
}
console.log(`limit ${LIMIT_KB} kB`);
if (worst > LIMIT_KB) {
  console.error('Over the first-visit budget.');
  process.exit(1);
}
