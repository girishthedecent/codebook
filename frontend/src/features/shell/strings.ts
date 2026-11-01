// Copy for the frame around every signed-in page: the guest bar, the waiting screen, the
// phone tabs. Sentence case, plain words.
export const shellStrings = {
  guest: {
    left: (left: number, limit: number) =>
      `${left} of ${limit} ${limit === 1 ? 'question' : 'questions'} left today`,
    none: 'No questions left today',
    resets: (when: string) => `Resets ${when}.`,
    deletion: 'Demo conversations are deleted after 7 days.',
    signIn: 'Sign in',
    signInLabel: 'Sign in to keep your conversations',
  },
  pending: {
    loading: 'Opening CodeBook',
    waking: 'Waking the server, this can take up to a minute.',
  },
  library: {
    open: 'Open the sidebar',
    title: 'Conversations and sources',
  },
  more: {
    title: 'More',
    signedInAs: (email: string) => `Signed in as ${email}`,
    demoVisitor: 'You are using the demo as a guest.',
  },
  shortcuts: {
    title: 'Keyboard shortcuts',
    description: 'Press ? again or Esc to close this list.',
  },
  backToDemo: 'Back to the demo',
  viewerLoading: 'Opening the source',
} as const;
