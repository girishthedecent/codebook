import { browseToc } from './browseToc.js';
import { findCallers, findDependencies, traceFlow } from './graphTools.js';
import { listFiles } from './listFiles.js';
import { readSource } from './readSource.js';
import { searchCode } from './searchCode.js';
import { searchSources } from './searchSources.js';
import type { AgentTool } from './tool.types.js';
import { webSearch } from './webSearch.js';

export type { AgentTool, ToolContext, ToolResult } from './tool.types.js';

// The order the model sees them in, which is roughly the order it should reach for them:
// the workspace's own sources first, the web last.
export const agentTools: AgentTool[] = [
  searchSources,
  searchCode,
  readSource,
  browseToc,
  listFiles,
  findCallers,
  findDependencies,
  traceFlow,
  webSearch,
];
