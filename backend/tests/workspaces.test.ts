import { beforeEach, describe, expect, it } from 'vitest';
import { appConfig } from '../src/config/app.config.js';
import prismaClient from '../src/config/db.config.js';
import { assertWorkspaceAccess } from '../src/modules/workspaces/workspace.service.js';
import { testApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { resetDb } from './helpers/db.js';

type User = Awaited<ReturnType<typeof signedInUser>>;

const MISSING_ID = 'cjld2cjxh0000qzrmn831i7rn';

let alice: User;

beforeEach(async () => {
  await resetDb();
  alice = await signedInUser('alice@example.com');
});

async function createWorkspace(user: User, body: object = { name: 'Notes' }) {
  const res = await user.agent.post('/api/v1/workspaces').send(body);
  expect(res.status).toBe(201);
  return res.body.data as { id: string; name: string; settings: object };
}

async function seedWorkspaces(userId: string, count: number, createdAt?: Date) {
  await prismaClient.workspace.createMany({
    data: Array.from({ length: count }, (_, i) => ({ userId, name: `ws ${i}`, createdAt })),
  });
}

async function countLockWaiters() {
  const [row] = await prismaClient.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
  `;
  return row?.count ?? 0;
}

describe('auth', () => {
  it('rejects requests without a session', async () => {
    const res = await testApp().get('/api/v1/workspaces');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('create', () => {
  it('creates a blank workspace by default', async () => {
    const res = await alice.agent
      .post('/api/v1/workspaces')
      .send({ name: '  Reading list  ', description: 'Books for Q4' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      message: 'Workspace created',
      data: {
        name: 'Reading list',
        description: 'Books for Q4',
        template: 'BLANK',
        isDemo: false,
        settings: {},
      },
    });
    expect(Object.keys(res.body.data).sort()).toEqual([
      'createdAt',
      'description',
      'id',
      'isDemo',
      'name',
      'settings',
      'template',
      'updatedAt',
    ]);
  });

  it('starts with the settings of the chosen template', async () => {
    const study = await createWorkspace(alice, { name: 'Book notes', template: 'STUDY' });
    expect(study.settings).toEqual({
      defaultSearchMode: 'hybrid',
      studyToolsEnabled: true,
      preferredTools: ['browse_toc', 'search_sources'],
    });

    const code = await createWorkspace(alice, { name: 'Repo', template: 'CODEBASE' });
    expect(code.settings).toEqual({
      preferredTools: ['search_code', 'find_callers', 'trace_flow'],
    });
  });

  it('stores an empty description as null', async () => {
    const workspace = await createWorkspace(alice, { name: 'Notes', description: '   ' });
    expect(workspace).toMatchObject({ description: null });
  });

  it.each([
    ['an empty name', { name: '   ' }, 'name'],
    ['a name over 80 characters', { name: 'x'.repeat(81) }, 'name'],
    [
      'a description over 500 characters',
      { name: 'ok', description: 'x'.repeat(501) },
      'description',
    ],
    ['an unknown template', { name: 'ok', template: 'NOVEL' }, 'template'],
  ])('rejects %s', async (_, body, field) => {
    const res = await alice.agent.post('/api/v1/workspaces').send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details).toEqual([expect.objectContaining({ path: field })]);
  });

  it('ignores fields the client may not set', async () => {
    const workspace = await createWorkspace(alice, { name: 'Notes', isDemo: true, userId: 'x' });
    const row = await prismaClient.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    expect(row).toMatchObject({ isDemo: false, userId: alice.userId });
  });

  it('stops at the per-user limit with 409', async () => {
    await seedWorkspaces(alice.userId, appConfig.workspaces.maxPerUser);

    const res = await alice.agent.post('/api/v1/workspaces').send({ name: 'One too many' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'CONFLICT',
      message: `You can have up to ${appConfig.workspaces.maxPerUser} workspaces. Delete one to create another.`,
    });
  });

  it('keeps the limit when creates race each other', async () => {
    await seedWorkspaces(alice.userId, appConfig.workspaces.maxPerUser - 1);

    // Hold a lock that blocks inserts into Workspace until all four requests are waiting on a
    // lock, so they really overlap. Without the row lock in the repository, every request has
    // already counted 19 by then and all four inserts go through.
    const requests = await prismaClient.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "Workspace" IN SHARE MODE`;
        const pending = Array.from({ length: 4 }, async (_, i) =>
          alice.agent.post('/api/v1/workspaces').send({ name: `race ${i}` }),
        );
        await expect.poll(() => countLockWaiters(), { timeout: 10_000 }).toBe(4);
        return pending;
      },
      { timeout: 15_000 },
    );

    const results = await Promise.all(requests);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await prismaClient.workspace.count({ where: { userId: alice.userId } })).toBe(
      appConfig.workspaces.maxPerUser,
    );
  });
});

describe('get', () => {
  it('returns the workspace', async () => {
    const workspace = await createWorkspace(alice);
    const res = await alice.agent.get(`/api/v1/workspaces/${workspace.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: workspace.id, name: 'Notes' });
  });

  it('returns 404 for an id that does not exist', async () => {
    const res = await alice.agent.get(`/api/v1/workspaces/${MISSING_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: 'Workspace not found' });
  });

  it('returns 400 for an id that is not a cuid', async () => {
    const res = await alice.agent.get('/api/v1/workspaces/not-an-id');
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([expect.objectContaining({ path: 'workspaceId' })]);
  });
});

describe('update', () => {
  it('renames and clears the description, leaving settings alone', async () => {
    const workspace = await createWorkspace(alice, {
      name: 'Notes',
      description: 'old',
      template: 'CODEBASE',
    });

    const res = await alice.agent
      .patch(`/api/v1/workspaces/${workspace.id}`)
      .send({ name: 'Renamed', description: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Renamed', description: null });
    expect(res.body.data.settings).toEqual(workspace.settings);
  });

  it('merges settings into the existing ones', async () => {
    const workspace = await createWorkspace(alice, { name: 'Book notes', template: 'STUDY' });

    const res = await alice.agent.patch(`/api/v1/workspaces/${workspace.id}`).send({
      settings: { studyToolsEnabled: false, preferredTools: ['web_search', 'web_search'] },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.settings).toEqual({
      defaultSearchMode: 'hybrid',
      studyToolsEnabled: false,
      preferredTools: ['web_search'],
    });
  });

  it('keeps both changes when two PATCHes touch different settings at once', async () => {
    const workspace = await createWorkspace(alice, { name: 'Book notes', template: 'STUDY' });
    const url = `/api/v1/workspaces/${workspace.id}`;

    // Lock the row so both requests are waiting before either reads the stored settings.
    const requests = await prismaClient.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "Workspace" WHERE id = ${workspace.id} FOR UPDATE`;
        const pending = [
          (async () => alice.agent.patch(url).send({ settings: { studyToolsEnabled: false } }))(),
          (async () =>
            alice.agent.patch(url).send({ settings: { defaultSearchMode: 'vector' } }))(),
        ];
        await expect.poll(() => countLockWaiters(), { timeout: 10_000 }).toBe(2);
        return pending;
      },
      { timeout: 15_000 },
    );

    expect((await Promise.all(requests)).map((r) => r.status)).toEqual([200, 200]);
    const row = await prismaClient.workspace.findUniqueOrThrow({ where: { id: workspace.id } });
    expect(row.settings).toMatchObject({ studyToolsEnabled: false, defaultSearchMode: 'vector' });
  });

  it.each([
    ['an empty body', {}],
    ['an unknown settings key', { settings: { theme: 'dark' } }],
    ['an unknown tool', { settings: { preferredTools: ['rm_rf'] } }],
    ['an unknown search mode', { settings: { defaultSearchMode: 'magic' } }],
  ])('rejects %s', async (_, body) => {
    const workspace = await createWorkspace(alice);
    const res = await alice.agent.patch(`/api/v1/workspaces/${workspace.id}`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('delete', () => {
  it('deletes with 204, then the workspace is gone', async () => {
    const workspace = await createWorkspace(alice);

    const res = await alice.agent.delete(`/api/v1/workspaces/${workspace.id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    expect((await alice.agent.get(`/api/v1/workspaces/${workspace.id}`)).status).toBe(404);
    expect((await alice.agent.delete(`/api/v1/workspaces/${workspace.id}`)).status).toBe(404);
  });

  it("goes away with its owner's account", async () => {
    const workspace = await createWorkspace(alice);
    await prismaClient.user.delete({ where: { id: alice.userId } });
    expect(await prismaClient.workspace.findUnique({ where: { id: workspace.id } })).toBeNull();
  });
});

describe('isolation between users', () => {
  let bob: User;
  let aliceWorkspaceId: string;

  beforeEach(async () => {
    bob = await signedInUser('bob@example.com');
    aliceWorkspaceId = (await createWorkspace(alice, { name: "Alice's" })).id;
  });

  it("hides another user's workspace from GET, PATCH and DELETE with 404", async () => {
    const url = `/api/v1/workspaces/${aliceWorkspaceId}`;

    for (const res of [
      await bob.agent.get(url),
      await bob.agent.patch(url).send({ name: 'Mine now' }),
      await bob.agent.delete(url),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    const row = await prismaClient.workspace.findUniqueOrThrow({ where: { id: aliceWorkspaceId } });
    expect(row.name).toBe("Alice's");
  });

  it('lists only your own workspaces', async () => {
    await createWorkspace(bob, { name: "Bob's" });

    const res = await bob.agent.get('/api/v1/workspaces');
    expect(res.body.data.items.map((w: { name: string }) => w.name)).toEqual(["Bob's"]);
  });

  it('lets anyone read the demo workspace only when the caller allows it', async () => {
    await prismaClient.workspace.update({
      where: { id: aliceWorkspaceId },
      data: { isDemo: true },
    });

    await expect(assertWorkspaceAccess(bob.userId, aliceWorkspaceId)).rejects.toThrow(
      'Workspace not found',
    );
    await expect(
      assertWorkspaceAccess(bob.userId, aliceWorkspaceId, { allowDemoRead: true }),
    ).resolves.toMatchObject({ id: aliceWorkspaceId });
  });
});

describe('list', () => {
  async function listAll(user: User, limit: number) {
    const names: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | null = null;
    do {
      const res = await user.agent
        .get('/api/v1/workspaces')
        .query({ limit, ...(cursor && { cursor }) });
      expect(res.status).toBe(200);
      const { items, nextCursor } = res.body.data as {
        items: { name: string }[];
        nextCursor: string | null;
      };
      names.push(...items.map((w) => w.name));
      pageSizes.push(items.length);
      cursor = nextCursor;
    } while (cursor);
    return { names, pageSizes };
  }

  it('returns newest first, page by page', async () => {
    for (const name of ['first', 'second', 'third', 'fourth', 'fifth']) {
      await createWorkspace(alice, { name });
    }

    const { names, pageSizes } = await listAll(alice, 2);
    expect(names).toEqual(['fifth', 'fourth', 'third', 'second', 'first']);
    expect(pageSizes).toEqual([2, 2, 1]);
  });

  it('returns nextCursor null when everything fits on one page', async () => {
    await createWorkspace(alice);
    const res = await alice.agent.get('/api/v1/workspaces');
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.nextCursor).toBeNull();
  });

  it('neither skips nor repeats rows that share a timestamp', async () => {
    await seedWorkspaces(alice.userId, 7, new Date('2026-01-01T00:00:00Z'));

    const { names } = await listAll(alice, 3);
    expect(names).toHaveLength(7);
    expect(new Set(names).size).toBe(7);
  });

  it.each([
    ['limit 0', { limit: 0 }],
    ['limit over the max', { limit: appConfig.pagination.maxLimit + 1 }],
    ['a cursor that is not base64 JSON', { cursor: 'nope' }],
    [
      'a cursor with the wrong shape',
      { cursor: Buffer.from(JSON.stringify({ id: 1 })).toString('base64url') },
    ],
  ])('rejects %s with 400', async (_, query) => {
    const res = await alice.agent.get('/api/v1/workspaces').query(query);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details).toEqual([expect.objectContaining({ path: Object.keys(query)[0] })]);
  });
});
