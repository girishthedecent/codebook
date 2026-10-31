import { Link, useRouter } from '@tanstack/react-router';
import { useMeQuery } from '@/api/queries/me';
import { Button } from './Button';
import { ErrorPage } from './ErrorPage';
import { TextButton } from './TextLink';

export function NotFound() {
  const router = useRouter();
  // Signed-in people go back to a workspace; everyone else to the front page.
  const signedIn = Boolean(useMeQuery().data);
  return (
    <ErrorPage
      kicker="404"
      title="There's nothing at this address."
      hint="The link may be old, or the page was removed."
      actions={
        <>
          <Button asChild>
            <Link to={signedIn ? '/w' : '/'}>
              {signedIn ? 'Go to your workspace' : 'Go to the start'}
            </Link>
          </Button>
          {router.history.canGoBack() && (
            <TextButton onClick={() => router.history.back()}>Go back</TextButton>
          )}
        </>
      }
    />
  );
}
