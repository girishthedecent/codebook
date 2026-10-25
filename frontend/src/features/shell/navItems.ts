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
