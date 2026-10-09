import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled with the app, not loaded from Google Fonts (unreliable from mainland China)
import '@fontsource/caprasimo/400.css';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/600.css';
import '@fontsource/figtree/700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { boot } from './app/boot';
import { followLocale } from './i18n';
import { followSession } from './pages/ai/aiStore';
import { Root } from './Root';

// Show the empty frame first; the sign-in page or the app appears once the sign-in state and local data are read, so the sample data never flashes
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
// The AI advisor follows the sign-in state: on opening an account it reads the key saved on this device; on sign-out it clears it
followSession();
// <html lang> and the page title follow the interface language
followLocale(document);
void boot(import.meta.env);
