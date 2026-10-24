import { createRequire } from 'node:module';
import { Language, Parser, type Tree } from 'web-tree-sitter';

// Grammars ship as WASM files inside their npm packages; resolving them through Node's
// resolver works the same from src/ and dist/.
const require = createRequire(import.meta.url);

const GRAMMARS = {
  typescript: 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  python: 'tree-sitter-python/tree-sitter-python.wasm',
} as const;

export type CodeLanguage = keyof typeof GRAMMARS;

export function isCodeLanguage(language: string | null): language is CodeLanguage {
  return language !== null && Object.hasOwn(GRAMMARS, language);
}

let ready: Promise<void> | undefined;
const parsers = new Map<CodeLanguage, Promise<Parser>>();

async function parserFor(language: CodeLanguage) {
  // A failed load isn't cached, so the next file (or the step's retry) tries again.
  ready ??= Parser.init().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  await ready;
  let parser = parsers.get(language);
  if (!parser) {
    parser = Language.load(require.resolve(GRAMMARS[language])).then(
      (grammar) => {
        const created = new Parser();
        created.setLanguage(grammar);
        return created;
      },
      (error: unknown) => {
        parsers.delete(language);
        throw error;
      },
    );
    parsers.set(language, parser);
  }
  return parser;
}

/**
 * The syntax tree of a source file. Node offsets are UTF-16 indexes into `text`, so they
 * slice the JavaScript string directly. Call `tree.delete()` when done: trees live in WASM
 * memory, which the garbage collector doesn't see.
 */
export async function parseCode(text: string, language: CodeLanguage): Promise<Tree | null> {
  const parser = await parserFor(language);
  return parser.parse(text);
}
