/** One visible node of a tree, in reading order (a parent comes right before its children). */
export type TreeEntry = {
  id: string;
  depth: number;
  parent?: string;
  expandable: boolean;
  open: boolean;
};

export type TreeMove = { focus?: string; toggle?: string };

/**
 * What a key does on a focused tree node, following the usual tree-widget keys. `columns` is for
 * a map drawn in columns by depth: up and down stay in the node's own column instead of walking
 * down the whole list.
 */
export function treeKey(
  key: string,
  id: string,
  list: TreeEntry[],
  layout: 'list' | 'columns',
): TreeMove | undefined {
  const at = list.findIndex((e) => e.id === id);
  const me = list[at];
  if (!me) return undefined;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      const step = key === 'ArrowDown' ? 1 : -1;
      let i = at + step;
      if (layout === 'columns') while (list[i] && list[i]!.depth !== me.depth) i += step;
      return list[i] ? { focus: list[i]!.id } : undefined;
    }
    case 'ArrowRight':
      if (!me.expandable) return undefined;
      return me.open ? { focus: list[at + 1]?.id } : { toggle: me.id };
    case 'ArrowLeft':
      if (me.expandable && me.open) return { toggle: me.id };
      return me.parent ? { focus: me.parent } : undefined;
    case 'Home':
      return { focus: list[0]!.id };
    case 'End':
      return { focus: list[list.length - 1]!.id };
    case 'Enter':
    case ' ':
      return me.expandable ? { toggle: me.id } : undefined;
    default:
      return undefined;
  }
}
