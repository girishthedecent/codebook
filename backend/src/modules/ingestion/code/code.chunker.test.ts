import { describe, expect, it } from 'vitest';
import { countTokens } from '../../../utils/tokens.js';
import type { ChunkSettings } from '../doc.chunker.js';
import type { ChunkPlan } from '../ingestion.types.js';
import { chunkCode } from './code.chunker.js';

const settings: ChunkSettings = {
  parentMaxTokens: 120,
  childTokens: 40,
  overlapTokens: 12,
  minSectionTokens: 5,
};

// Every chunk's lines must contain its text; children stay inside, and in order within, parents.
function expectConsistent(text: string, plan: ChunkPlan) {
  const all = text.split('\n');
  for (const chunk of [...plan.parents, ...plan.children]) {
    const covered = all.slice(chunk.lineStart! - 1, chunk.lineEnd!).join('\n');
    expect(covered).toContain(text.slice(chunk.start, chunk.end));
    expect(chunk.pageStart).toBeNull();
    expect(chunk.pageEnd).toBeNull();
    expect(chunk.headingPath.length).toBeGreaterThan(0);
  }
  plan.children.forEach((child, i) => {
    const parent = plan.parents[child.parentIndex]!;
    expect(child.start).toBeGreaterThanOrEqual(parent.start);
    expect(child.end).toBeLessThanOrEqual(parent.end);
    const before = plan.children[i - 1];
    if (before?.parentIndex === child.parentIndex) {
      expect(child.start).toBeGreaterThanOrEqual(before.start);
    }
  });
}

const childContaining = (plan: ChunkPlan, offset: number) =>
  plan.children.filter((c) => c.start <= offset && offset < c.end);

const body = (n: number, name = 'x') =>
  Array.from({ length: n }, (_, i) => `  ${name}.push(compute${i}(input, ${i}));`).join('\n');

describe('chunkCode on TypeScript', () => {
  const small = [
    "import { db } from './d';",
    '',
    '// Finds a user.',
    'export function findUser(id: string) {',
    '  return db.get(id);',
    '}',
    '',
    'export const handler = () => db.all();',
  ].join('\n');

  it('packs small declarations into one parent and child', async () => {
    // Each declaration is under half a child, so they share one.
    const roomy = { ...settings, childTokens: 80 };
    const plan = (await chunkCode(small, 'typescript', 'src/user.ts', roomy))!;
    expect(countTokens(small)).toBeLessThan(roomy.childTokens / 2);
    expect(plan.parents).toHaveLength(1);
    expect(plan.children).toHaveLength(1);
    expect(plan.children[0]).toMatchObject({
      headingPath: ['src/user.ts'],
      symbolName: null,
      lineStart: 1,
      lineEnd: 8,
    });
    expectConsistent(small, plan);
  });

  it('gives a declaration of half a child or more a child of its own', async () => {
    const plan = (await chunkCode(small, 'typescript', 'src/user.ts', settings))!;
    expect(countTokens(small.split('\n').slice(2, 6).join('\n'))).toBeGreaterThanOrEqual(
      settings.childTokens / 2,
    );
    expect(plan.children.map((child) => child.symbolName)).toContain('findUser');
    expectConsistent(small, plan);
  });

  const service = [
    "import { db } from './db';",
    '',
    '/** Handles sign in. */',
    'export class AuthService {',
    '  // Checks a password.',
    '  login(user: string, password: string) {',
    body(6, 'rows'),
    '    return rows;',
    '  }',
    '',
    '  logout(user: string) {',
    body(6, 'out'),
    '    return out;',
    '  }',
    '',
    '  refresh(token: string) {',
    body(6, 'tokens'),
    '    return tokens;',
    '  }',
    '}',
    '',
    'export const handler = () => {',
    body(8, 'calls'),
    '  return calls;',
    '};',
  ].join('\n');

  it('splits a big class into contiguous parents of its members', async () => {
    const plan = (await chunkCode(service, 'typescript', 'src/auth.ts', settings))!;
    expect(countTokens(service)).toBeGreaterThan(settings.parentMaxTokens);
    expectConsistent(service, plan);
    const classParents = plan.parents.filter((p) => p.headingPath[1] === 'class AuthService');
    expect(classParents.length).toBeGreaterThan(1);
    // Parents of the class are contiguous: each starts where the previous one ended.
    classParents.slice(1).forEach((parent, i) => {
      const gap = service.slice(classParents[i]!.end, parent.start);
      expect(gap.trim()).toBe('');
    });
  });

  it('names members with the qualified symbol and a nested heading path', async () => {
    const plan = (await chunkCode(service, 'typescript', 'src/auth.ts', settings))!;
    const login = childContaining(plan, service.indexOf('login(user'))[0]!;
    expect(login.headingPath).toEqual(['src/auth.ts', 'class AuthService', 'login']);
    expect(login.symbolName).toBe('AuthService.login');
    const handler = childContaining(plan, service.indexOf('export const handler'))[0]!;
    expect(handler.headingPath).toEqual(['src/auth.ts', 'function handler']);
    expect(handler.symbolName).toBe('handler');
  });

  it('keeps a declaration name line inside some child and the comment above with it', async () => {
    const plan = (await chunkCode(service, 'typescript', 'src/auth.ts', settings))!;
    for (const name of ['login(user', 'logout(user', 'refresh(token', 'export const handler']) {
      expect(childContaining(plan, service.indexOf(name)).length).toBeGreaterThan(0);
    }
    const login = childContaining(plan, service.indexOf('login(user'))[0]!;
    expect(login.start).toBeLessThanOrEqual(service.indexOf('// Checks a password.'));
    const cls = childContaining(plan, service.indexOf('export class'))[0]!;
    expect(cls.start).toBeLessThanOrEqual(service.indexOf('/** Handles sign in. */'));
  });

  it('splits a function with many statements into children of whole statements', async () => {
    const text = ['function first() { return 1; }', '', 'function long() {', body(40), '}'].join(
      '\n',
    );
    const plan = (await chunkCode(text, 'typescript', 'src/long.ts', settings))!;
    expectConsistent(text, plan);
    const inLong = plan.children.filter((c) => c.symbolName === 'long');
    expect(inLong.length).toBeGreaterThan(2);
    for (const child of inLong) {
      expect(child.headingPath).toEqual(['src/long.ts', 'function long']);
      expect(child.tokenCount).toBeLessThanOrEqual(
        settings.childTokens + settings.minSectionTokens,
      );
    }
    const first = plan.children[0]!;
    expect(text.slice(first.start, first.end)).toContain('function first');
    expect(first.end).toBeLessThanOrEqual(text.indexOf('function long'));
  });

  it('splits one huge statement at lines, repeating whole lines inside that symbol only', async () => {
    const text = [
      'function first() { return 1; }',
      '',
      'function long() {',
      '  const items = [',
      ...Array.from({ length: 30 }, (_, i) => `    compute${i}(input, ${i}),`),
      '  ];',
      '}',
    ].join('\n');
    const plan = (await chunkCode(text, 'typescript', 'src/long.ts', settings))!;
    expectConsistent(text, plan);
    const inLong = plan.children.filter((c) => c.symbolName === 'long');
    expect(inLong.length).toBeGreaterThan(3);
    const overlapping = inLong.filter((c, i) => i > 0 && c.lineStart! <= inLong[i - 1]!.lineEnd!);
    expect(overlapping.length).toBeGreaterThan(0);
    for (const child of inLong) {
      expect(child.start).toBeGreaterThanOrEqual(text.indexOf('function long'));
      expect(text[child.start - 1] === '\n' || text[child.start - 1] === undefined).toBe(true);
    }
    const lines = text.split('\n');
    inLong.forEach((child, i) => {
      if (i === 0) return;
      const before = inLong[i - 1]!;
      const repeated = lines.slice(child.lineStart! - 1, before.lineEnd!).join('\n');
      expect(countTokens(repeated)).toBeLessThanOrEqual(settings.overlapTokens);
    });
  });

  it('names an assigned function by its target', async () => {
    const text = ['res.send = function () {', '  return 1;', '};'].join('\n');
    const plan = (await chunkCode(text, 'javascript', 'lib/res.js', settings))!;
    expect(plan.children[0]).toMatchObject({
      headingPath: ['lib/res.js', 'function res.send'],
      symbolName: 'res.send',
    });
  });

  it('keeps a symbol and a neighbour in one child with their common path', async () => {
    const text = ['class A {', '  one() { return 1; }', '  two() { return 2; }', '}'].join('\n');
    const plan = (await chunkCode(text, 'typescript', 'a.ts', { ...settings, childTokens: 8 }))!;
    expectConsistent(text, plan);
    expect(plan.children.length).toBeGreaterThan(1);
    const shared = plan.children.find((c) => c.symbolName === null);
    if (shared) expect(shared.headingPath[0]).toBe('a.ts');
  });
});

describe('chunkCode on other languages', () => {
  it('chunks JavaScript functions', async () => {
    const text = ['function a() {', '  return 1;', '}', '', 'const b = (x) => x * 2;'].join('\n');
    const plan = (await chunkCode(text, 'javascript', 'a.js', settings))!;
    expect(plan.children).toHaveLength(1);
    expectConsistent(text, plan);
  });

  const python = [
    'import os',
    '',
    'def helper(a, b):',
    '    return a + b',
    '',
    '@cached',
    'def decorated(x):',
    '    return x',
    '',
    'class Store:',
    '    def get(self, key):',
    ...Array.from({ length: 8 }, (_, i) => `        value${i} = self.read(key, ${i})`),
    '        return value0',
    '',
    '    def put(self, key, value):',
    ...Array.from({ length: 8 }, (_, i) => `        self.write(key, value, ${i})`),
    '        return None',
  ].join('\n');

  it('chunks Python functions, classes with methods and decorated definitions', async () => {
    const plan = (await chunkCode(python, 'python', 'app/store.py', settings))!;
    expectConsistent(python, plan);
    const decorated = childContaining(plan, python.indexOf('def decorated'))[0]!;
    expect(decorated.start).toBeLessThanOrEqual(python.indexOf('@cached'));
    const get = childContaining(plan, python.indexOf('def get'))[0]!;
    expect(get.headingPath).toEqual(['app/store.py', 'class Store', 'get']);
    expect(get.symbolName).toBe('Store.get');
    const put = childContaining(plan, python.indexOf('self.write(key, value, 3)'))[0]!;
    expect(put.symbolName).toBe('Store.put');
  });

  it('returns null for a file with syntax errors', async () => {
    expect(await chunkCode('function (', 'typescript', 'bad.ts', settings)).toBeNull();
    expect(await chunkCode('def f(:\n  pass', 'python', 'bad.py', settings)).toBeNull();
  });

  describe('chunkCode on decorated and field members', () => {
    const lines = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `    const v${i} = await this.service.load(id, ${i});`,
      ).join('\n');

    it('keeps a TypeScript method with its decorator and the comment above it', async () => {
      const text = [
        '@Controller("users")',
        'export class UsersController {',
        "  @Get(':id')",
        '  async findOne(id: string) {',
        lines(8),
        '  }',
        '',
        '  /** Makes one. */',
        '  @Post()',
        '  async create(id: string) {',
        lines(8),
        '  }',
        '}',
      ].join('\n');
      const plan = (await chunkCode(text, 'typescript', 'u.ts', settings))!;
      const create = plan.children.find((child) => child.symbolName === 'UsersController.create')!;
      expect(text.split('\n')[create.lineStart! - 1]).toBe('  /** Makes one. */');
      expectConsistent(text, plan);
    });

    it('names JavaScript class fields that hold functions', async () => {
      const text = [
        'class Button extends Component {',
        '  handleClick = () => {',
        lines(8),
        '  };',
        '}',
      ].join('\n');
      const plan = (await chunkCode(text, 'javascript', 'b.js', settings))!;
      expect(plan.children.map((child) => child.symbolName)).toContain('Button.handleClick');
      expectConsistent(text, plan);
    });
  });
});
