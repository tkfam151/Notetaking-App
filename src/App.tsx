import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Library } from './components/Library';
import { EditorScreen } from './components/EditorScreen';
import { LoginScreen, NewPasswordScreen } from './components/LoginScreen';
import { getSettings, saveSettings, DEFAULT_SETTINGS, selectAccountStorage } from './lib/db';
import { cloud, cloudEnabled, friendlyError, isApp, loginRequired, type CloudUser } from './lib/cloud';
import { openSharedDoc } from './lib/sharing';
import type { Settings } from './types';

type Route = { kind: 'home' } | { kind: 'doc'; id: string } | { kind: 'shared'; cloudId: string } | { kind: 'login' };

function readRoute(): Route {
  if (location.hash.startsWith('#/login')) return { kind: 'login' };
  const doc = location.hash.match(/^#\/doc\/([\w-]+)/);
  if (doc) return { kind: 'doc', id: doc[1] };
  const shared = location.hash.match(/^#\/shared\/([\w-]+)/);
  if (shared) return { kind: 'shared', cloudId: shared[1] };
  return { kind: 'home' };
}

export interface Account {
  user: CloudUser;
  signOut: () => void;
}

/** Apps only: open the (optional) sign-in page, then come back here. */
export function requestSignIn() {
  try {
    sessionStorage.setItem('inkwell.afterLogin', location.hash || '#/');
  } catch {
    /* ignore */
  }
  location.hash = '#/login';
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // Web: 'loading' until we know whether someone is signed in. Apps never wait for this.
  const [user, setUser] = useState<CloudUser | null | 'loading'>(loginRequired ? 'loading' : null);
  const [storageReady, setStorageReady] = useState(!loginRequired);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Sign-in state
  useEffect(() => {
    if (!cloudEnabled) return;
    let offAuth = () => {};
    let offRecovery = () => {};
    cloud()
      .then(async (api) => {
        offAuth = api.onAuthChange((u) => setUser(u));
        offRecovery = api.onPasswordRecovery(() => setRecovering(true));
        setUser(await api.getUser());
      })
      .catch(() => setUser(null));
    return () => {
      offAuth();
      offRecovery();
    };
  }, []);

  // Web: each account gets its own on-device storage. (The apps are single-user devices
  // and keep one store, so signing in or out never hides your documents there.)
  const userId = user && user !== 'loading' ? user.id : null;
  useEffect(() => {
    if (!loginRequired) return;
    setStorageReady(false);
    if (!userId) return;
    selectAccountStorage(userId).then(() => setStorageReady(true));
  }, [userId]);

  useEffect(() => {
    if (storageReady) getSettings().then(setSettings);
  }, [storageReady]);

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

  // Default the comment author name to the account email the first time.
  useEffect(() => {
    if (storageReady && userId && user && user !== 'loading' && settings.authorName === DEFAULT_SETTINGS.authorName) {
      updateSettings({ authorName: user.email.split('@')[0] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageReady, userId]);


  const openDoc = useCallback((id: string) => {
    location.hash = `#/doc/${id}`;
  }, []);
  const goHome = useCallback(() => {
    if (history.length > 1 && readRoute().kind !== 'home') history.back();
    setTimeout(() => {
      if (readRoute().kind !== 'home') location.hash = '#/';
    }, 50);
  }, []);

  // Apps: after signing in on the optional login page, go back to where you were.
  const signedIn = !!user && user !== 'loading';
  useEffect(() => {
    if (isApp && signedIn && route.kind === 'login') {
      let back = '#/';
      try {
        back = sessionStorage.getItem('inkwell.afterLogin') || '#/';
        sessionStorage.removeItem('inkwell.afterLogin');
      } catch {
        /* ignore */
      }
      location.replace(back);
    }
  }, [signedIn, route.kind]);

  if (loginRequired) {
    if (user === 'loading') return <div className="loading-screen" />;
    if (recovering && user) return <NewPasswordScreen onDone={() => setRecovering(false)} />;
    if (!user) return <LoginScreen />;
    if (!storageReady) return <div className="loading-screen" />;
  }

  const account: Account | null =
    cloudEnabled && user && user !== 'loading'
      ? {
          user,
          signOut: () => {
            cloud().then((api) => api.signOut());
            if (!isApp) location.hash = '#/';
          },
        }
      : null;

  if (route.kind === 'login') {
    if (!cloudEnabled || signedIn) return <div className="loading-screen" />;
    return <LoginScreen onCancel={() => (history.length > 1 ? history.back() : (location.hash = '#/'))} />;
  }

  if (route.kind === 'shared') {
    if (cloudEnabled && !account) {
      return (
        <LoginScreen
          note="Sign in to open the document that was shared with you."
          onCancel={() => (location.hash = '#/')}
        />
      );
    }
    return <SharedOpener cloudId={route.cloudId} account={account} />;
  }

  return route.kind === 'doc' ? (
    <EditorScreen
      key={route.id}
      docId={route.id}
      settings={settings}
      updateSettings={updateSettings}
      onHome={goHome}
      onOpen={openDoc}
      account={account}
    />
  ) : (
    <Library settings={settings} updateSettings={updateSettings} onOpen={openDoc} account={account} />
  );
}

/** Handles #/shared/<id> links: finds or creates the local copy, then opens it. */
function SharedOpener({ cloudId, account }: { cloudId: string; account: Account | null }) {
  const [state, setState] = useState<'loading' | 'denied' | string>('loading');
  useEffect(() => {
    if (!cloudEnabled) {
      setState('This version of Inkwell can’t open shared documents.');
      return;
    }
    openSharedDoc(cloudId)
      .then((localId) => {
        if (localId) location.replace(`#/doc/${localId}`);
        else setState('denied');
      })
      .catch((e) => setState(friendlyError(e)));
  }, [cloudId]);

  if (state === 'loading')
    return (
      <div className="empty full">
        <Loader2 size={32} className="spin" />
        <p>Opening shared document…</p>
      </div>
    );
  return (
    <div className="empty full">
      <FileText size={48} />
      <p>
        {state === 'denied' ? (
          <>
            You don’t have access to this document.
            <br />
            Ask the owner to share it with <strong>{account?.user.email}</strong>, or to turn on link sharing.
          </>
        ) : (
          state
        )}
      </p>
      <button className="btn btn-primary" onClick={() => (location.hash = '#/')}>
        Go to my documents
      </button>
    </div>
  );
}
