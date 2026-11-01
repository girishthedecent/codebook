import { hydrateRoot } from 'react-dom/client';
import { Landing } from './features/landing/Landing';

// The entry for `/`. The page arrives as prerendered HTML, so this only has to make it
// interactive, and waits until the browser has painted it. The app itself is not loaded.
const root = document.getElementById('root');
if (root) {
  requestAnimationFrame(() => {
    setTimeout(() => hydrateRoot(root, <Landing standalone />), 0);
  });
}
