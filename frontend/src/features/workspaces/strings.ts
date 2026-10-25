export const workspaceStrings = {
  switcher: {
    label: 'Switch workspace',
    workspaces: 'Workspaces',
    new: 'New workspace…',
    rename: 'Rename…',
    delete: 'Delete…',
    settings: 'Settings',
    signOut: 'Sign out',
    signIn: 'Sign in',
    guest: 'Demo visitor',
  },
  fields: {
    name: 'Name',
    description: 'Description',
    optional: 'optional',
    kind: 'Starts as',
  },
  templates: {
    BLANK: ['General', 'No preferences; the agent chooses freely.'],
    STUDY: ['Study', 'Leans on the table of contents and turns on study tools.'],
    CODEBASE: ['Codebase', 'Leans on code search and the call graph.'],
  },
  create: {
    title: 'New workspace',
    submit: 'Create workspace',
  },
  first: {
    title: 'Make your first workspace',
    body: 'A workspace holds the books, repositories and pages you want to ask about together.',
  },
  rename: { title: 'Rename workspace', submit: 'Save' },
  remove: {
    title: 'Delete workspace',
    body: 'This removes its sources, conversations and study sets. It cannot be undone.',
    confirm: (name: string) => `Type “${name}” to confirm`,
    submit: 'Delete workspace',
  },
} as const;
