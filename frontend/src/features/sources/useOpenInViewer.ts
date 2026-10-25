import { useNavigate } from '@tanstack/react-router';
import { viewerSearchFor, type ViewerTarget } from '@/lib/viewerParams';

/** Opens the viewer at a target, keeping the current route and its other search params. */
export function useOpenInViewer() {
  const navigate = useNavigate();
  return (target: ViewerTarget) =>
    void navigate({
      to: '.',
      search: (s: Record<string, unknown>) => ({ ...s, ...viewerSearchFor(target) }),
    });
}
