import { useEffect, useRef, useState } from 'react';
import { isApiError } from '@/api/client';
import { useNavigate } from '@tanstack/react-router';
import { CaretUpDown, Check, Stack } from '@phosphor-icons/react';
import { useDemo } from '@/api/queries/demo';
import { flatItems } from '@/api/queries/keys';
import { useWorkspace, useWorkspaces } from '@/api/queries/workspaces';
import type { Workspace } from '@/api/types';
import { useMe } from '@/auth';
import { useSignOut } from '@/auth/useSignOut';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/ui';
import { cn } from '@/lib/cn';
import { forgetWorkspace } from './lastWorkspace';
import {
  DeleteWorkspaceDialog,
  NewWorkspaceDialog,
  RenameWorkspaceDialog,
} from './WorkspaceDialogs';
import { workspaceStrings } from './strings';

const t = workspaceStrings.switcher;
type OpenDialog = 'new' | 'rename' | 'delete' | null;

/**
 * The sidebar header: the current workspace's name, and a menu to switch, create, rename or
 * delete workspaces plus the account rows. Guests only ever see the demo workspace.
 */
export function WorkspaceSwitcher({
  workspaceId,
  collapsed,
}: {
  workspaceId: string;
  collapsed: boolean;
}) {
  const navigate = useNavigate();
  const { signOut } = useSignOut();
  const { me, isGuest } = useMe();
  const currentQuery = useWorkspace(workspaceId);
  const own = flatItems(useWorkspaces().data);
  const demo = useDemo().data?.workspace;
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // The demo is shared and read-only: anyone can open it, but only the seed changes it.
  const inDemo = demo?.id === workspaceId;
  const current = currentQuery.data;
  const missing = isApiError(currentQuery.error, 404);
  useEffect(() => {
    // `/w` would otherwise keep reopening a workspace that no longer exists.
    if (missing) forgetWorkspace(workspaceId);
  }, [missing, workspaceId]);

  // Closing a dialog opened from the menu: the menu item that opened it is gone, so focus
  // would fall to the page. Put it back on the switcher.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (dialog === null && wasOpen.current) requestAnimationFrame(() => trigger.current?.focus());
    wasOpen.current = dialog !== null;
  }, [dialog]);
  const changeDialog = (which: Exclude<OpenDialog, null>) => (open: boolean) =>
    setDialog(open ? which : null);

  const list: Workspace[] = isGuest ? (demo ? [demo] : []) : own;
  // Only workspaces in the user's own list can be changed; the demo is read-only for visitors.
  const editable = !isGuest && own.some((w) => w.id === workspaceId);
  const name = missing ? t.missing : (current?.name ?? (inDemo ? demo.name : ''));

  const goTo = (id: string) =>
    void navigate({ to: '/w/$workspaceId', params: { workspaceId: id } });

  return (
    <>
      <Menu
        align="start"
        className="w-[260px]"
        trigger={
          <button
            ref={trigger}
            type="button"
            aria-label={`${t.label}: ${name}`}
            title={collapsed ? name : undefined}
            className={cn(
              'flex h-12 w-full items-center gap-2 text-left text-sm',
              'hover:bg-paper-3 focus-visible:bg-paper-3 focus-visible:outline-offset-[-2px]',
              collapsed ? 'justify-center px-0' : 'px-4',
            )}
          >
            {collapsed ? (
              <span className="flex size-10 items-center justify-center text-ink">
                <Stack size={20} aria-hidden />
              </span>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{name}</span>
                <CaretUpDown size={14} className="shrink-0 text-ink-3" aria-hidden />
              </>
            )}
          </button>
        }
      >
        <MenuLabel>{t.workspaces}</MenuLabel>
        {!isGuest && inDemo && (
          <MenuItem icon={<Check size={14} weight="bold" />}>
            <span className="block max-w-[180px] truncate">{demo.name}</span>
          </MenuItem>
        )}
        {list.map((w) => (
          <MenuItem
            key={w.id}
            onSelect={() => goTo(w.id)}
            icon={w.id === workspaceId ? <Check size={14} weight="bold" /> : <span />}
          >
            <span className="block max-w-[180px] truncate">{w.name}</span>
          </MenuItem>
        ))}
        {!isGuest && <MenuItem onSelect={() => setDialog('new')}>{t.new}</MenuItem>}
        {editable && current && (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => setDialog('rename')}>{t.rename}</MenuItem>
            <MenuItem danger onSelect={() => setDialog('delete')}>
              {t.delete}
            </MenuItem>
          </>
        )}
        <MenuSeparator />
        <MenuLabel>
          <span className="block max-w-[220px] truncate">{isGuest ? t.guest : me?.email}</span>
        </MenuLabel>
        {isGuest ? (
          <MenuItem
            onSelect={() =>
              void navigate({ to: '/sign-in', search: { next: `/w/${workspaceId}` } })
            }
          >
            {t.signIn}
          </MenuItem>
        ) : (
          <>
            <MenuItem onSelect={() => void navigate({ href: '/settings' })}>{t.settings}</MenuItem>
            <MenuItem onSelect={() => void signOut()}>{t.signOut}</MenuItem>
          </>
        )}
      </Menu>

      <NewWorkspaceDialog open={dialog === 'new'} onOpenChange={changeDialog('new')} />
      {current && (
        <>
          <RenameWorkspaceDialog
            workspace={current}
            open={dialog === 'rename'}
            onOpenChange={changeDialog('rename')}
          />
          <DeleteWorkspaceDialog
            workspace={current}
            open={dialog === 'delete'}
            onOpenChange={changeDialog('delete')}
          />
        </>
      )}
    </>
  );
}
