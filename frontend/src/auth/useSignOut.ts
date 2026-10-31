import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from '@/ui';
import { en } from '@/i18n/en';
import { signOut as endSession } from './session';

/** Ends the session and goes to the front page; a failure leaves the person signed in and says so. */
export function useSignOut() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    setPending(true);
    try {
      await endSession();
      void navigate({ to: '/', replace: true });
    } catch {
      toast({
        title: en.auth.signOutFailed,
        description: en.auth.signOutFailedHint,
        kind: 'error',
      });
    } finally {
      setPending(false);
    }
  };

  return { signOut, pending };
}
