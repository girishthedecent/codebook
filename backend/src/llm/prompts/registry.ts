import { createHash } from 'node:crypto';

// Placeholder names in a template, e.g. "Hello {{name}}" → "name". Checked at compile time
// so a prompt can't be rendered with a variable missing.
type Vars<T extends string> = T extends `${string}{{${infer Name}}}${infer Rest}`
  ? Name | Vars<Rest>
  : never;

export type PromptTemplate<T extends string = string> = {
  name: string;
  version: number;
  // `name@vN`: what usage rows, messages and eval runs record.
  id: string;
  // Content hash. prompt-hashes.json pins it per id, so an edit needs a version bump.
  hash: string;
  text: T;
  render(vars: Record<Vars<T>, string>): string;
};

const defined = new Set<string>();

export function definePrompt<const T extends string>(def: {
  name: string;
  version: number;
  text: T;
}): PromptTemplate<T> {
  const id = `${def.name}@v${def.version}`;
  if (defined.has(id)) throw new Error(`Prompt ${id} is defined twice`);
  // The type accepts any text between the braces; render only fills plain names, so
  // something like "{{ name }}" would otherwise reach the model unfilled.
  for (const [placeholder, name] of def.text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    if (!/^\w+$/.test(name!)) throw new Error(`Prompt ${id} has a bad placeholder ${placeholder}`);
  }
  defined.add(id);

  return {
    ...def,
    id,
    hash: createHash('sha256').update(def.text).digest('hex').slice(0, 16),
    render(vars) {
      return def.text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
        const value = (vars as Record<string, string | undefined>)[name];
        if (value === undefined) throw new Error(`Prompt ${id} is missing "${name}"`);
        return value;
      });
    },
  };
}

/**
 * Compares prompts with the committed hashes. A changed hash under the same id means the
 * text was edited without bumping the version, so old eval results would point at a
 * prompt that no longer exists. Ids missing from the lock are new versions to add.
 */
export function checkPromptHashes(
  prompts: readonly Pick<PromptTemplate, 'id' | 'hash'>[],
  lock: Record<string, string>,
) {
  const problems: string[] = [];
  for (const { id, hash } of prompts) {
    const locked = lock[id];
    if (locked === undefined) {
      problems.push(`${id} is new: add "${id}": "${hash}" to prompt-hashes.json`);
    } else if (locked !== hash) {
      problems.push(`${id} changed without a version bump`);
    }
  }
  return problems;
}
