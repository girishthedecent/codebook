import { randomUUID } from 'node:crypto';
import { appConfig } from '../../config/app.config.js';
import prismaClient from '../../config/db.config.js';

/** The seeded demo workspace: the one its system owner marked as the demo. */
export async function findDemoWorkspace() {
  return prismaClient.workspace.findFirst({
    where: { isDemo: true, user: { email: appConfig.demo.ownerEmail, isSystem: true } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function listDemoSources(workspaceId: string) {
  return prismaClient.source.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
}

/** The owner row, made or brought back to a system user. */
export async function upsertDemoOwner() {
  return prismaClient.user.upsert({
    where: { email: appConfig.demo.ownerEmail },
    update: { isSystem: true, isGuest: false },
    create: {
      id: randomUUID(),
      name: 'CodeBook demo',
      email: appConfig.demo.ownerEmail,
      emailVerified: true,
      isSystem: true,
    },
  });
}

export async function hasPasswordLogin(userId: string) {
  const login = await prismaClient.account.findFirst({
    where: { userId, providerId: 'credential' },
    select: { id: true },
  });
  return login !== null;
}

export async function findOwnedWorkspace(userId: string, name: string) {
  return prismaClient.workspace.findFirst({ where: { userId, name } });
}

export async function createDemoWorkspace(userId: string, name: string, description: string) {
  return prismaClient.workspace.create({ data: { userId, name, description, isDemo: true } });
}

export async function markDemo(workspaceId: string, description: string) {
  return prismaClient.workspace.update({
    where: { id: workspaceId },
    data: { isDemo: true, description },
  });
}
