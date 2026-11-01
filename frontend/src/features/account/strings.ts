// Copy for the pages outside a workspace: memory, usage, settings, the phone "More" tab and the
// command menu. Sentence case, plain words.

type Place = { name: string; n: number; total: number };
type Counts = Record<
  'workspaces' | 'conversations' | 'messages' | 'highlights' | 'memories',
  number
>;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
export const strings = {
  layout: {
    back: (name: string) => `Back to ${name}`,
    backFallback: 'Back to your workspaces',
    backDemo: 'Back to the demo',
    nav: 'Account',
  },
  nav: {
    memory: 'Memory',
    usage: 'Usage',
    settings: 'Settings',
    admin: 'Admin',
    graph: 'Code graph',
    highlights: 'Highlights',
    more: 'More',
    signOut: 'Sign out',
  },
  memory: {
    title: 'Memory',
    intro:
      'CodeBook keeps short notes about you and the facts you share, so later answers can take them into account. ' +
      'It adds them after a conversation, and you can edit or remove any of them here. ' +
      'To ask a question without it, turn off "Use memory" in the conversation.',
    kinds: {
      PROFILE: { label: 'About you', hint: 'Your role, what you work on, how you like answers.' },
      FACT: { label: 'Facts', hint: 'Things you told CodeBook that it should keep in mind.' },
    },
    profileCount: (n: number, cap: number) =>
      `${n} of ${cap} lines used. When the list is full, a new line replaces the least important one.`,
    empty: 'Nothing remembered yet.',
    emptyKind: { PROFILE: 'Nothing about you yet.', FACT: 'No facts yet.' },
    showDeleted: 'Show deleted',
    deleted: 'Deleted',
    used: (when: string) => `used ${when}`,
    added: (when: string) => `added ${when}`,
    edit: 'Edit',
    remove: 'Remove',
    restore: 'Restore',
    removed: 'Memory removed',
    undo: 'Undo',
    addTitle: 'Add a memory',
    addLabel: 'What should CodeBook remember?',
    addHint: (max: number) => `Up to ${max} characters.`,
    kindLabel: 'Kind',
    importanceLabel: 'Importance',
    importance: ['Minor', 'Low', 'Normal', 'High', 'Essential'],
    importanceOf: (n: number, label: string) => `${label} importance (${n} of 5)`,
    add: 'Add',
    clearAll: 'Clear all',
    clearTitle: 'Clear all memories',
    clearBody: 'Every memory is removed. This cannot be undone.',
    clearConfirm: 'Type "clear" to confirm',
    clearWord: 'clear',
    cleared: 'All memories cleared',
  },
  usage: {
    title: 'Usage',
    intro:
      'What your questions have used so far. Counts include the model calls behind each answer.',
    guestIntro: 'The demo gives every visitor a small allowance of questions each day.',
    week: 'Last 7 days',
    weekHint: 'Days run midnight to midnight, UTC.',
    questions: 'Questions',
    tokens: 'Tokens',
    cost: 'Cost',
    weekBefore: (n: string) => `${n} the week before`,
    month: (questions: string, tokens: string, cost: string) =>
      `Over the last 30 days: ${questions} questions, ${tokens} tokens, ${cost}.`,
    days: {
      label: (n: number, total: string) =>
        `Questions per day over the last ${n} days, ${total} in all`,
      reading: (day: string, questions: number, tokens: string, cost: string) =>
        `${day}: ${questions === 1 ? '1 question' : `${questions} questions`}, ${tokens} tokens, ${cost}`,
      today: 'Today',
      table: 'Show as table',
      cols: { day: 'Day', questions: 'Questions', tokens: 'Tokens', cost: 'Cost' },
    },
    limits: 'Limits',
    limitRows: {
      messagesThisHour: 'Questions this hour',
      messagesToday: 'Questions today',
      tokensToday: 'Tokens today',
    },
    remaining: (left: string, total: string) => `${left} of ${total} left`,
    resets: (when: string) => `Starts over ${when}.`,
    guestLabel: 'Questions in the demo today',
    guestLeft: (left: number, total: number) => `${left} of ${total} left today`,
    guestResets: (when: string) => `The allowance resets ${when}.`,
    guestEmpty: "You've used today's questions.",
    guestMore: 'Signed-in accounts get a larger allowance and keep their conversations.',
    guestSignIn: 'Sign in',
    storage: 'Storage',
    storageRow: (used: string, total: string) => `${used} of ${total} for uploaded books`,
    sources: (n: number) => (n === 1 ? '1 source' : `${n} sources`),
    loading: 'Loading usage',
  },
  settings: {
    title: 'Settings',
    theme: 'Theme',
    themes: { system: 'Same as the system', light: 'Light', dark: 'Dark' },
    shortcuts: 'Keyboard shortcuts',
    shortcutRows: {
      command: 'Search and commands',
      help: 'Show these shortcuts',
      composer: 'Focus the message box',
      close: 'Close the viewer or a dialog',
      citations: 'Previous and next citation in the viewer',
      pages: 'Previous and next page of a book',
      find: 'Find in the viewer',
      cards: 'Previous and next flashcard',
      know: 'Flashcard: I know it, I don’t know it',
      quiz: 'Pick a quiz answer, then go on',
    },
    reading: {
      title: 'Reading',
      hint: 'For answers and pages of text. Kept in this browser.',
      size: 'Text size',
      sizes: { s: 'Small', m: 'Medium', l: 'Large' },
      measure: 'Line length',
      measures: {
        narrow: ['Narrow', 'About 65 characters a line, the easiest to follow.'],
        wide: ['Wide', 'About 80 characters, for a big screen.'],
      },
      sample:
        'Self-attention lets every token look at every earlier one. In nanoGPT the mask is a ' +
        'lower-triangular matrix, so a position can never read the tokens that come after it, ' +
        'which is what makes the model causal.',
      sampleLabel: 'How answers will look',
    },
    data: {
      title: 'Your data',
      hint:
        'One JSON file with your workspaces, conversations and their messages, highlights and ' +
        'memories. Uploaded books and repositories are not in it.',
      download: 'Download everything',
      cancel: 'Stop',
      progress: {
        workspaces: 'Listing your workspaces…',
        conversations: (w: Place) => `${w.name} (${w.n} of ${w.total}): listing conversations…`,
        messages: (w: Place, n: number, total: number) =>
          `${w.name} (${w.n} of ${w.total}): conversation ${n} of ${total}`,
        highlights: (w: Place) => `${w.name} (${w.n} of ${w.total}): highlights…`,
        memories: 'Reading your memories…',
      },
      done: (file: string, c: Counts) =>
        `Saved ${file}: ${plural(c.workspaces, 'workspace')}, ${plural(c.conversations, 'conversation')}, ` +
        `${plural(c.messages, 'message')}, ${plural(c.highlights, 'highlight')} and ${plural(c.memories, 'memory', 'memories')}.`,
      failed: 'The download stopped part way. Nothing was saved.',
      fileName: (date: string) => `codebook-${date}.json`,
    },
    account: 'Account',
    email: 'Email',
    name: 'Name',
    nameSave: 'Save name',
    nameSaved: 'Name updated',
    password: {
      title: 'Password',
      change: 'Change password',
      current: 'Current password',
      next: 'New password',
      hint: 'At least 8 characters. Other devices are signed out.',
      save: 'Save password',
      saved: 'Password changed',
      none: 'You sign in with GitHub, so this account has no password to change.',
    },
    github: {
      title: 'GitHub',
      linked: 'Linked. You can sign in with it.',
      notLinked: 'Not linked.',
      link: 'Link GitHub',
      unknown: 'Linked accounts are unavailable right now.',
      failed: "GitHub couldn't be linked. It has to use the same email address as this account.",
    },
    signOut: 'Sign out',
    delete: {
      title: 'Delete account',
      reason:
        "Accounts can't be deleted from here yet. Meanwhile you can delete each workspace and clear your memory.",
      button: 'Delete account',
    },
    guest: "You're using the demo as a guest. Sign in to keep your conversations.",
    signIn: 'Sign in',
    backToDemo: 'Back to the demo',
    failed: 'Something went wrong. Try again.',
  },
  command: {
    label: 'Command menu',
    placeholder: 'Type a command or search',
    empty: 'No matches.',
    goTo: 'Go to',
    workspaces: 'Workspaces',
    conversations: 'Recent conversations',
    actions: 'Actions',
    chat: 'Chat',
    sources: 'Sources',
    study: 'Study',
    newConversation: 'New conversation',
    toggleTheme: 'Switch to light or dark',
    shortcuts: 'Keyboard shortcuts',
  },
} as const;
