import { createAuthClient } from 'better-auth/react';
import { anonymousClient } from 'better-auth/client/plugins';

// Same origin as the app (`/api/auth` behind the dev proxy and the production reverse proxy),
// so no baseURL is needed and the session cookie is first-party.
export const authClient = createAuthClient({
  plugins: [anonymousClient()],
});
