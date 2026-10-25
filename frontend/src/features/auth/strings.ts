export const authStrings = {
  title: 'Sign in to CodeBook',
  github: 'Continue with GitHub',
  orEmail: 'Or with email',
  tabs: { signIn: 'Sign in', signUp: 'Create account' },
  fields: {
    name: 'Name',
    email: 'Email',
    password: 'Password',
    passwordHint: 'At least 8 characters.',
  },
  submit: { signIn: 'Sign in', signUp: 'Create account' },
  reasonGuest: 'Sign in to add your own sources.',
  guestLink: 'Your demo conversations move to the account you sign in with.',
  back: 'Back to the start',
  demo: {
    opening: 'Opening the demo',
    limit:
      'The demo can only be opened a few times a day from one address. Try again tomorrow, or sign in.',
    missing: "The demo isn't available right now.",
    failed: "The demo couldn't be opened.",
    signIn: 'Sign in instead',
  },
} as const;
