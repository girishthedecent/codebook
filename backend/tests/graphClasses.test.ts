import type { Agent } from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prismaClient from '../src/config/db.config.js';
import { textRoutes } from '../src/llm/models.js';
import { downloadTarball, resolveCommit } from '../src/utils/github.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';
import {
  codeContextReply,
  createPdfSource,
  createRepoSource,
  ingest,
} from './helpers/ingestion.js';
import { promptModel, useModels } from './helpers/llm-mock.js';
import { buildTarball } from './helpers/repo.js';

vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
vi.mock('../src/utils/pacer.js', () => import('./helpers/no-pacing.js'));
vi.mock('../src/utils/github.js', () => ({
  resolveCommit: vi.fn(),
  downloadTarball: vi.fn(),
}));

// A small model in the shape of nanoGPT: classes whose constructors build other classes, with
// the calls into the library made inside methods.
const FILES: Record<string, string> = {
  'model.py': `import math
import torch
import torch.nn as nn
from torch.nn import functional as F


class Block(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.ln = nn.LayerNorm(config)
        self.proj = nn.Linear(config, config)

    def forward(self, x):
        return x + F.gelu(self.proj(self.ln(x)))


class GPT(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.block = Block(config)
        self.scale = math.sqrt(config)
        self.tokens = nn.Embedding(config, config)

    def forward(self, idx):
        return self.tokens(idx)

    def generate(self, idx):
        return torch.cat([idx, self.forward(idx)])
`,
  'train.py': `from model import GPT, Block
import numpy as np


def main():
    model = GPT(1)
    return model.generate(np.zeros(3))


def helper():
    return Block(2)


result = main()
`,
};

type Symbol = {
  qualifiedName: string;
  name: string;
  kind: string;
  depth: number;
  via: string | null;
};

let alice: Agent;
let aliceId: string;
let workspaceId: string;
let sourceId: string;

beforeEach(async () => {
  await resetDb();
  ({ agent: alice, userId: aliceId } = await signedInUser('alice@example.com'));
  const res = await alice.post('/api/v1/workspaces').send({ name: 'Graph' });
  workspaceId = (res.body as { data: { id: string } }).data.id;
  useModels({ [textRoutes.contextualize.primary.model]: promptModel(codeContextReply) });
  vi.mocked(resolveCommit).mockResolvedValue({ sha: 'a'.repeat(40) });
  vi.mocked(downloadTarball).mockImplementation(
    async () =>
      new Response(
        buildTarball(Object.entries(FILES).map(([path, content]) => ({ path, content }))),
      ).body!,
  );
  sourceId = await createRepoSource(workspaceId);
  await ingest(sourceId);
});

const graph = (path: string) => alice.get(`/api/v1/sources/${sourceId}/graph/${path}`);
const data = <T>(res: { body: unknown }) => (res.body as { data: T }).data;
const names = (symbols: Symbol[]) => symbols.map((symbol) => symbol.qualifiedName);

describe('what a class depends on', () => {
  it('is what its methods call', async () => {
    const res = await graph('dependencies?symbol=model.py%23GPT&depth=1');

    expect(res.status).toBe(200);
    const { symbol, symbols, external } = data<{
      symbol: Symbol;
      symbols: Symbol[];
      external: { toName: string }[];
    }>(res);
    expect(symbol.qualifiedName).toBe('model.py#GPT');
    // Block(config) in the constructor; its own methods (self.forward) are not dependencies.
    expect(symbols.map((s) => [s.qualifiedName, s.kind, s.depth, s.via])).toEqual([
      ['model.py#Block', 'CLASS', 1, null],
    ]);
    expect(external.map((edge) => edge.toName)).toEqual(
      expect.arrayContaining(['math.sqrt', 'nn.Embedding', 'torch.cat']),
    );
  });

  it('goes on into the constructor of a class it reaches', async () => {
    const one = await graph('dependencies?symbol=model.py%23GPT&depth=1');
    expect(
      data<{ external: { toName: string }[] }>(one).external.map((e) => e.toName),
    ).not.toContain('nn.LayerNorm');

    const two = await graph('dependencies?symbol=model.py%23GPT&depth=2');
    expect(data<{ external: { toName: string }[] }>(two).external.map((e) => e.toName)).toEqual(
      expect.arrayContaining(['nn.LayerNorm', 'nn.Linear', 'nn.Embedding']),
    );
  });

  it('is unchanged for a method', async () => {
    const res = await graph('dependencies?symbol=model.py%23GPT.generate&depth=1');
    expect(names(data<{ symbols: Symbol[] }>(res).symbols)).toEqual(['model.py#GPT.forward']);
  });
});

describe('who calls a constructor or its class', () => {
  const callers = async (symbol: string, depth = 1) => {
    const res = await graph(`callers?symbol=${encodeURIComponent(symbol)}&depth=${depth}`);
    expect(res.status).toBe(200);
    return data<{ symbol: Symbol; symbols: Symbol[] }>(res);
  };

  it('lists the calls of Block(config) as callers of Block.__init__', async () => {
    const { symbol, symbols } = await callers('model.py#Block.__init__');

    expect(symbol.qualifiedName).toBe('model.py#Block.__init__');
    expect(names(symbols).sort()).toEqual(['model.py#GPT.__init__', 'train.py#helper']);
  });

  it('lists the same callers for the class, and leaves out the pair itself', async () => {
    const { symbol, symbols } = await callers('model.py#Block');

    expect(symbol.qualifiedName).toBe('model.py#Block');
    expect(names(symbols).sort()).toEqual(['model.py#GPT.__init__', 'train.py#helper']);
  });

  it('follows the pair at every hop: callers of the class that built it', async () => {
    const { symbols } = await callers('model.py#Block.__init__', 2);

    const main = symbols.find((s) => s.qualifiedName === 'train.py#main')!;
    const constructor = symbols.find((s) => s.qualifiedName === 'model.py#GPT.__init__')!;
    // main calls GPT(1); GPT.__init__ is where GPT is built.
    expect(main).toMatchObject({ depth: 2 });
    expect(main.via).toBe(
      (
        await prismaClient.codeSymbol.findFirstOrThrow({
          where: { sourceId, qualifiedName: 'model.py#GPT.__init__' },
        })
      ).id,
    );
    expect(constructor.depth).toBe(1);
  });

  it('is unchanged for a method that is not a constructor', async () => {
    const { symbols } = await callers('model.py#GPT.forward');
    expect(names(symbols)).toEqual(['model.py#GPT.generate']);
  });
});

describe('GET /graph/overview', () => {
  type Overview = {
    topSymbols: (Symbol & { callers: number; calls: number })[];
    files: { path: string; symbols: number }[];
    packages: { name: string; calls: number }[];
  };

  it('lists the busiest symbols, a constructor counted with its class', async () => {
    const res = await graph('overview');

    expect(res.status).toBe(200);
    const { topSymbols } = data<Overview>(res);
    const byName = Object.fromEntries(topSymbols.map((s) => [s.qualifiedName, s]));
    // main: called from the module, calls GPT(...) and generate. Constructors never show.
    expect(topSymbols[0]).toMatchObject({ qualifiedName: 'train.py#main', callers: 1, calls: 2 });
    expect(byName['model.py#GPT']).toMatchObject({ kind: 'CLASS', callers: 1, calls: 1 });
    expect(byName['model.py#Block']).toMatchObject({ callers: 2, calls: 0 });
    expect(Object.keys(byName).some((name) => name.endsWith('__init__'))).toBe(false);
    expect(topSymbols.every((s) => s.kind !== 'FILE')).toBe(true);
    expect(topSymbols.length).toBeLessThanOrEqual(6);
    expect(topSymbols[0]).toHaveProperty('lineStart');
  });

  it('counts the symbols of each file, the most first', async () => {
    const { files } = data<Overview>(await graph('overview'));
    expect(files).toEqual([
      { path: 'model.py', symbols: 7 },
      { path: 'train.py', symbols: 2 },
    ]);
  });

  it('counts the calls into each package by the names its imports bind', async () => {
    const { packages } = data<Overview>(await graph('overview'));
    // nn and F (aliases of parts of torch) and torch itself; np is numpy.
    expect(packages).toEqual([
      { name: 'torch', calls: 5 },
      { name: 'math', calls: 1 },
      { name: 'numpy', calls: 1 },
    ]);
  });

  it('follows the access rules of the other graph routes', async () => {
    const bob = await signedInUser('bob@example.com');
    const url = `/api/v1/sources/${sourceId}/graph/overview`;
    expect((await bob.agent.get(url)).status).toBe(404);

    const pdfId = await createPdfSource(aliceId, workspaceId);
    expect((await alice.get(`/api/v1/sources/${pdfId}/graph/overview`)).status).toBe(400);

    await prismaClient.workspace.update({ where: { id: workspaceId }, data: { isDemo: true } });
    const shared = await bob.agent.get(url);
    expect(shared.status).toBe(200);
    expect(data<Overview>(shared).files).toHaveLength(2);
  });
});
