import { Books, ChatText, Cards, DotsThree, TreeStructure } from '@phosphor-icons/react';
import { en } from '@/i18n/en';

// One list of workspace sections for the sidebar and the phone tabs, so the icons stay in step.
export const icons = {
  chat: ChatText,
  sources: Books,
  graph: TreeStructure,
  study: Cards,
  more: DotsThree,
};

export const labels = en.nav;

// The pages that sit beside the workspaces rather than inside one. They open in the same frame,
// so the phone "More" tab stays lit on them.
const accountRoots = ['/memory', '/usage', '/settings', '/admin'];

export function isAccountPath(pathname: string) {
  return accountRoots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}
