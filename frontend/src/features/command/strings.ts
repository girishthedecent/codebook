// Copy for the command menu's sources, passages and actions. The rest of its copy is shared
// with the account strings.
export const commandStrings = {
  placeholder: 'Type a command, or search the sources',
  sources: 'Sources',
  passages: 'In the sources',
  searching: 'Searching the sources',
  passagesFailed: "The sources couldn't be searched just now.",
  switchTheme: 'Switch theme',
  goTo: (page: string) => `Go to ${page}`,
  library: 'Library',
  graph: 'Graph',
  highlights: 'Highlights',
} as const;
