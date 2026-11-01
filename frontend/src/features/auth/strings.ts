export const authStrings = {
  title: 'Sign in to CodeBook',
  intro: 'Your workspaces, conversations and study sets are kept.',
  createTitle: 'Create your account',
  createIntro: 'An account lets you add your own books and repositories.',
  github: 'Continue with GitHub',
  githubFailed: "GitHub sign-in didn't finish. Try again, or use email.",
  noAccount: 'Just looking?',
  tryDemo: 'Try the demo without an account',
  orEmail: 'Or with email',
  tabs: { signIn: 'Sign in', signUp: 'Create account' },
  fields: {
    name: 'Name',
    email: 'Email',
    password: 'Password',
    passwordHint: 'At least 8 characters.',
  },
  submit: { signIn: 'Sign in', signUp: 'Create account' },
  reasonGuest: 'The demo is read-only. Sign in to add your own sources and keep a memory.',
  guestLink: 'Your demo conversations move to the account you sign in with.',
  tooMany: 'Too many attempts. Wait a minute and try again.',
  failed: 'Something went wrong. Try again.',
  aside: {
    line: 'Ask a book and its code together.',
    body:
      'CodeBook reads a PDF, a GitHub repository and a documentation site as one workspace. ' +
      'Every answer cites its sources, and each citation opens at the page or lines it came from.',
  },
  back: 'Back to the start',
  demo: {
    opening: 'Opening the demo',
    limit:
      'The demo can only be opened a few times a day from one address. Try again tomorrow, or sign in.',
    missing: "The demo isn't available right now.",
    failed: "The demo couldn't be opened.",
    signIn: 'Sign in instead',
    retry: 'Try again',
  },
} as const;
