import { appConfig } from '../../config/app.config.js';
import { NotFoundError } from '../../utils/errors/app.error.js';
import {
  createDemoWorkspace,
  findDemoWorkspace,
  findOwnedWorkspace,
  hasPasswordLogin,
  listDemoSources,
  markDemo,
  upsertDemoOwner,
} from './demo.repository.js';

/** What a visitor sees before signing in as a guest. */
export async function getDemoService() {
  const workspace = await findDemoWorkspace();
  if (!workspace) throw new NotFoundError('The demo workspace has not been set up');
  return { workspace, sources: await listDemoSources(workspace.id) };
}

// ---- seeding (pnpm db:seed -- --demo) ---------------------------------------------------

/**
 * The system user that owns the demo. It has no password, so nobody signs in as it; an
 * account of that email that can sign in (registered by hand) is refused, since it would
 * own the only workspace guests can read.
 */
export async function ensureDemoOwner() {
  const owner = await upsertDemoOwner();
  if (await hasPasswordLogin(owner.id)) {
    throw new Error(`${appConfig.demo.ownerEmail} has a password; delete that user first`);
  }
  return owner;
}

/** The owner's demo workspace, created on the first run and found again on later ones. */
export async function ensureDemoWorkspace(ownerId: string, description: string) {
  const { workspaceName } = appConfig.demo;
  const existing = await findOwnedWorkspace(ownerId, workspaceName);
  if (!existing) return createDemoWorkspace(ownerId, workspaceName, description);
  if (!existing.isDemo || existing.description !== description) {
    return markDemo(existing.id, description);
  }
  return existing;
}
