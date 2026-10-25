// All user-facing strings live here so copy stays consistent and could be translated later.
// Sentence case, plain words, no exclamation marks.
export const en = {
  app: { name: 'CodeBook', tagline: 'Ask a book and its code together.' },
  nav: {
    chat: 'Chat',
    sources: 'Sources',
    study: 'Study',
    graph: 'Code graph',
    memory: 'Memory',
    usage: 'Usage',
    settings: 'Settings',
    admin: 'Admin',
    more: 'More',
  },
  auth: {
    signIn: 'Sign in',
    signOut: 'Sign out',
    tryDemo: 'Try the demo',
    guestBar: "You're trying the demo.",
    guestKeep: 'Sign in to keep your work',
    guestNoWrite: 'Sign in to add your own sources.',
  },
  common: {
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    rename: 'Rename',
    retry: 'Try again',
    close: 'Close',
    loading: 'Loading',
    offline: 'You seem to be offline.',
  },
} as const;
