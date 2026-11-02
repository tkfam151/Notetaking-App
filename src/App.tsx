import { useCallback, useEffect, useState } from 'react';
import { Library } from './components/Library';
import { EditorScreen } from './components/EditorScreen';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from './lib/db';
import type { Settings } from './types';

function readRoute(): string | null {
  const m = location.hash.match(/^#\/doc\/([\w-]+)/);
  return m ? m[1] : null;
}

export default function App() {
  const [docId, setDocId] = useState<string | null>(readRoute);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    getSettings().then(setSettings);
    const onHash = () => setDocId(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Theme
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1b1d22' : '#3b5bdb');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const openDoc = useCallback((id: string) => {
    location.hash = `#/doc/${id}`;
  }, []);
  const goHome = useCallback(() => {
    if (history.length > 1 && readRoute()) history.back();
    // Fall back to resetting the hash if history.back() did not navigate
    setTimeout(() => {
      if (readRoute()) location.hash = '#/';
    }, 50);
  }, []);

  return docId ? (
    <EditorScreen key={docId} docId={docId} settings={settings} updateSettings={updateSettings} onHome={goHome} onOpen={openDoc} />
  ) : (
    <Library settings={settings} updateSettings={updateSettings} onOpen={openDoc} />
  );
}
