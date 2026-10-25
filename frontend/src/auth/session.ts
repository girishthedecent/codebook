import { ApiError } from '@/api/client';
import { keys } from '@/api/queries/keys';
import { queryClient } from '@/api/queryClient';
import type { Me } from '@/api/types';
import { authClient } from './authClient';

type AuthFailure = { status: number; code?: string; message?: string } | null;

function throwIfFailed(error: AuthFailure) {
  if (!error) return;
  throw new ApiError(error.status, {
    success: false,
    code: error.code ?? 'AUTH_ERROR',
    message: error.message ?? 'Sign-in failed',
  });
}

async function refreshMe(): Promise<Me | null> {
  await queryClient.invalidateQueries({ queryKey: keys.me });
  return queryClient.fetchQuery({ queryKey: keys.me });
}

/** Creates a guest session (rate-limited by the backend: a few per day per address). */
export async function startGuest(): Promise<Me> {
  const { error } = await authClient.signIn.anonymous();
  throwIfFailed(error);
  const me = await refreshMe();
  if (!me) throw new ApiError(401, undefined);
  return me;
}

/**
 * Starts the GitHub OAuth flow; the browser leaves the page. When the current session is a
 * guest, better-auth links it to the GitHub account and the backend moves the guest's
 * conversations over, so nothing is lost. The same happens for the email flows below.
 */
export async function signInWithGitHub(callbackURL = '/') {
  const { error } = await authClient.signIn.social({ provider: 'github', callbackURL });
  throwIfFailed(error);
}

export async function signInWithEmail(email: string, password: string): Promise<Me> {
  const { error } = await authClient.signIn.email({ email, password });
  throwIfFailed(error);
  const me = await refreshMe();
  if (!me) throw new ApiError(401, undefined);
  return me;
}

export async function signUpWithEmail(name: string, email: string, password: string): Promise<Me> {
  const { error } = await authClient.signUp.email({ name, email, password });
  throwIfFailed(error);
  const me = await refreshMe();
  if (!me) throw new ApiError(401, undefined);
  return me;
}

/** Ends the session and drops everything cached for this user. */
export async function signOut() {
  await authClient.signOut();
  queryClient.clear();
}
