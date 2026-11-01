import { type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { Citation } from '@/api/types';
import { citationCaption, citationDestination } from '@/features/citations/citationTarget';
import { useOpenCitation } from '@/features/citations/openCitation';
import { askAbout } from '@/lib/askAbout';
import { Menu, MenuItem } from '@/ui';
import { citationsOf, type MindmapNode } from './data';
import { s } from './strings';

type Props = {
  node: MindmapNode;
  /** The labels from the root down to this node, which give a bare label its context. */
  trail: string[];
  index: Map<number, Citation>;
  workspaceId: string;
  /** The set's title, named as the origin when the topic cites nothing. */
  title: string;
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/** What can be done with one topic: ask about it in a new conversation, or read where it comes from. */
export function NodeMenu({
  node,
  trail,
  index,
  workspaceId,
  title,
  trigger,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: Props) {
  const navigate = useNavigate();
  const openCitation = useOpenCitation();
  const cited = citationsOf(node, index).find((c) => citationDestination(c).kind !== 'none');

  const ask = () => {
    const target = cited ? citationDestination(cited) : undefined;
    askAbout({
      quote: trail.join(' › '),
      label: cited ? citationCaption(cited) : s.map.fromSet(title),
      target: target?.kind === 'viewer' ? target.target : undefined,
    });
    void navigate({ to: '/w/$workspaceId', params: { workspaceId } });
  };

  return (
    <Menu
      align="end"
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <MenuItem onSelect={ask}>{s.map.ask}</MenuItem>
      <MenuItem disabled={!cited} onSelect={() => cited && openCitation(cited)}>
        {cited ? s.map.openSource : s.map.noSource}
      </MenuItem>
    </Menu>
  );
}
