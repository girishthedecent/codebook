import type { SourceStage } from '@/api/types';

// Copy for the code graph. Sentence case, plain words.
export const graphStrings = {
  title: 'Code graph',
  back: 'More',
  repo: 'Repository',
  search: 'Find a symbol',
  searchPlaceholder: 'Function, class, method or file',
  noMatches: 'Nothing by that name.',
  explore: 'Explore',
  trace: 'Trace',
  connections: 'Connections',
  map: 'Map',
  mapLabel: 'View',
  depth: 'Depth',
  direction: 'Direction',
  callers: 'Callers',
  both: 'Both',
  dependencies: 'Dependencies',
  calledBy: 'Called by',
  calls: 'Calls',
  nothingCalls: 'Nothing in the repository calls this.',
  callsNothing: 'It calls nothing else in the repository.',
  alreadyAbove: 'Already shown above',
  expand: 'Show',
  collapse: 'Hide',
  more: (n: number) => `Show ${n} more`,
  fewer: 'Show fewer',
  openInViewer: 'Open the code',
  center: 'Center',
  fitView: 'Fit',
  selectHint: 'Tap a node to open its code or center the map on it.',
  selectHintKeys:
    'Click a node, or Tab to one and press Enter, then open its code or center the map on it.',
  traceFromHere: 'Trace from here',
  traceToHere: 'Trace to here',
  pickHint: 'Search for a function, class or file to see what calls it and what it calls.',
  fileSymbols: (path: string) => `What ${path} defines`,
  noFileSymbols: 'No symbols were found in this file.',
  truncated: 'Showing the nearest results only; there are more.',
  capped: (shown: number, total: number) =>
    `Showing the ${shown} nearest of ${total} symbols. The Connections tab lists the rest.`,
  moreNode: (n: number, callers: boolean) => `+${n} more ${callers ? 'callers' : 'calls'}`,
  moreNodeHint: 'Show them in the list',
  retry: 'Try again',
  offline: 'You seem to be offline.',
  sourcesError: "The repositories couldn't be loaded.",
  searchError: "Search didn't work. Try again.",
  openSource: 'Open the source',
  noRepo: 'This workspace has no repository yet.',
  noRepoGuest: 'There is no repository in this workspace to draw.',
  addRepo: 'Add a GitHub repository',
  loading: 'Loading the graph',
  notFound: "That symbol isn't in this repository any more.",
  ambiguous: 'More than one symbol has that name. Pick it from the search box.',
  error: "The graph couldn't be loaded.",
  correlation: 'Reference',

  callersHop: (n: number) => (n === 1 ? 'Calling it directly' : `Reaching it in ${n} calls`),
  callsHop: (n: number) => (n === 1 ? 'Called directly' : `Reached in ${n} calls`),
  mapLegend:
    'Callers on the left, what it calls on the right. An arrow points to the symbol that is called.',
  mapSmall: 'This neighbourhood is small enough to read as a list.',
  inFile: 'in',
  methodOf: 'of',

  // The overview
  startTitle: 'Where to start',
  startHint: 'The symbols the rest of the code leans on most.',
  callCount: (n: number) => (n === 1 ? 'called from 1 place' : `called from ${n} places`),
  callsCount: (n: number) => (n === 1 ? 'calls 1 other' : `calls ${n} others`),
  filesTitle: 'File by file',
  filesHint: 'Open a file to see what it defines.',
  symbolsIn: (n: number) => (n === 1 ? '1 symbol' : `${n} symbols`),
  showAllFiles: (n: number) => `Show all ${n} files`,
  packagesTitle: 'Libraries it leans on',
  packagesHint: 'Where its calls to outside code go.',
  packageCalls: (n: number) => (n === 1 ? '1 call' : `${n} calls`),
  emptyGraph: 'No functions or classes were found in this repository.',

  // What lies outside the repository
  outsideTitle: 'Outside the repository',
  outsideHint:
    'Libraries, built-ins and calls the graph could not match to a definition, grouped by the name each call starts with.',
  outsideCapped: 'Only the first 100 are listed; there are more.',
  directCalls: 'Called by name',
  ownMethods: 'Methods of the same object',
  andMore: (n: number) => `and ${n} more`,

  // Trace
  traceFrom: 'From',
  traceTo: 'To',
  traceIntro: (max: number) =>
    `Find the shortest chain of calls from one symbol to another, within ${max} calls.`,
  swap: 'Swap the two ends',
  noPath: (max: number) => `No chain of ${max} calls or fewer connects these two.`,
  noPathSwap: 'It may run the other way.',
  pathTruncated: 'The search stopped early; a longer chain may exist.',
  reaches: 'reaches',
  withinCalls: (n: number) => (n === 1 ? 'in 1 call' : `in ${n} calls`),
  traceMaxCalls: 6,

  // Header
  statsLine: (s: { symbols: number; inside: number; outside: number }) =>
    `${s.symbols.toLocaleString()} symbols · ${s.inside.toLocaleString()} calls inside the repo · ${s.outside.toLocaleString()} to libraries or unmatched`,
  stateIndexing: (name: string) => `Reading ${name}`,
  stateIndexingHint:
    'You can leave this page. The graph appears here when the repository is ready.',
  stateFailed: 'This repository could not be indexed',
  stateFailedNoReason: 'Indexing stopped before it finished.',
  unsupportedTitle: "The graph doesn't cover this repository's languages",
  unsupported: (found: string) =>
    found
      ? `Code graphs are drawn for Python, JavaScript and TypeScript. This repository is mostly ${found}, so search and chat work on it but there is no graph.`
      : 'Code graphs are drawn for Python, JavaScript and TypeScript, and none of those were found here.',
  noGraphTitle: 'No graph for this repository yet',
  noGraphOwner:
    'It was indexed before graphs existed. Resync it from its page and the graph is built.',
  noGraphGuest: 'The graph for this repository is not available right now.',
} as const;

export const stageWords: Record<SourceStage, string> = {
  QUEUED: 'Waiting to start',
  FETCHING: 'Fetching the files',
  FILTERING: 'Choosing which files to read',
  PARSING: 'Reading the code',
  STRUCTURING: 'Working out its structure',
  CHUNKING: 'Cutting it into passages',
  CONTEXTUALIZING: 'Writing notes on each passage',
  EMBEDDING: 'Indexing the passages for search',
  INDEXING: 'Saving the index',
  DONE: 'Done',
};

const kinds: Record<string, { short: string; noun: string }> = {
  FILE: { short: 'file', noun: 'a file' },
  CLASS: { short: 'class', noun: 'a class' },
  INTERFACE: { short: 'interface', noun: 'an interface' },
  FUNCTION: { short: 'function', noun: 'a function' },
  METHOD: { short: 'method', noun: 'a method' },
};

/** "function", "class"; unknown kinds are written as the backend names them. */
export const kindLabel = (kind: string) => kinds[kind]?.short ?? kind.toLowerCase();

/** "a function", "an interface": for a sentence about the symbol. */
export const kindNoun = (kind: string) => kinds[kind]?.noun ?? `a ${kind.toLowerCase()}`;
