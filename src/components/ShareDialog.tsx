import { useEffect, useState } from 'react';
import { Check, Copy, Globe, Link2, Loader2, Lock, Mail } from 'lucide-react';
import { cloud, friendlyError, shareLink, type CloudRole, type LinkAccess, type Share } from '../lib/cloud';
import { Modal, useUI } from './ui';

interface Props {
  title: string;
  me: string;
  /** Cloud id, or null if the document hasn't been shared yet */
  cloudId: string | null;
  role: CloudRole;
  sharedBy?: string;
  /** Uploads the document so it can be shared; returns its cloud id */
  ensureShared: () => Promise<string>;
  onClose: () => void;
}

const initials = (s: string) => s.slice(0, 1).toUpperCase();

export function ShareDialog({ title, me, cloudId: initialId, role, sharedBy, ensureShared, onClose }: Props) {
  const ui = useUI();
  const isOwner = role === 'owner';
  const [cloudId, setCloudId] = useState<string | null>(initialId);
  const [shares, setShares] = useState<Share[]>([]);
  const [link, setLink] = useState<LinkAccess>('none');
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<Share['role']>('edit');
  const [busy, setBusy] = useState<string | null>(isOwner ? 'Preparing…' : null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Owners: upload on first share, then load who has access.
  useEffect(() => {
    if (!isOwner) {
      if (initialId) cloud().then((api) => api.getLinkAccess(initialId)).then(setLink, () => {});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const id = initialId ?? (await ensureShared());
        const api = await cloud();
        const [s, l] = await Promise.all([api.listShares(id), api.getLinkAccess(id)]);
        if (cancelled) return;
        setCloudId(id);
        setShares(s);
        setLink(l);
      } catch (e) {
        if (!cancelled) setError(friendlyError(e));
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const invite = () => {
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) {
      setError('Enter a valid email address.');
      return;
    }
    if (addr === me) {
      setError('That’s you. You already own this document.');
      return;
    }
    run('Inviting…', async () => {
      await (await cloud()).setShare(cloudId!, addr, newRole);
      setShares((s) => [...s.filter((x) => x.email !== addr), { email: addr, role: newRole }]);
      setEmail('');
      ui.toast(`Shared with ${addr}`);
    });
  };

  const url = cloudId ? shareLink(cloudId) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy this link:', url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const mailto = `mailto:${shares.map((s) => s.email).join(',')}?subject=${encodeURIComponent(
    `“${title}” on Inkwell`,
  )}&body=${encodeURIComponent(`I shared a document with you on Inkwell:\n\n${url}\n\nSign in with this email address to open it.`)}`;

  return (
    <Modal
      title={`Share “${title}”`}
      onClose={onClose}
      width={540}
      footer={
        <>
          {cloudId && (
            <button className="btn" onClick={copy}>
              {copied ? <Check size={16} /> : <Link2 size={16} />} {copied ? 'Link copied' : 'Copy link'}
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {!isOwner ? (
        <div className="share-section">
          <p>
            <strong>{sharedBy}</strong> shared this document with you. You can{' '}
            <strong>{role === 'edit' ? 'edit' : 'view'}</strong> it.
          </p>
          <p className="muted small">Only the owner can change who has access.</p>
        </div>
      ) : (
        <>
          <div className="share-invite">
            <input
              type="email"
              placeholder="Add people by email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && invite()}
              disabled={!cloudId}
              aria-label="Email address to share with"
            />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as Share['role'])} aria-label="Access for new person" disabled={!cloudId}>
              <option value="edit">Editor</option>
              <option value="view">Viewer</option>
            </select>
            <button className="btn btn-primary" onClick={invite} disabled={!cloudId || !email.trim() || !!busy}>
              Invite
            </button>
          </div>

          <h3 className="share-h">People with access</h3>
          <ul className="share-people">
            <li>
              <span className="avatar">{initials(me)}</span>
              <span className="share-email">
                {me} <span className="muted">(you)</span>
              </span>
              <span className="muted small">Owner</span>
            </li>
            {shares.map((s) => (
              <li key={s.email}>
                <span className="avatar alt">{initials(s.email)}</span>
                <span className="share-email">{s.email}</span>
                <select
                  value={s.role}
                  aria-label={`Access for ${s.email}`}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'remove')
                      run('Removing…', async () => {
                        await (await cloud()).removeShare(cloudId!, s.email);
                        setShares((all) => all.filter((x) => x.email !== s.email));
                      });
                    else
                      run('Saving…', async () => {
                        await (await cloud()).setShare(cloudId!, s.email, v as Share['role']);
                        setShares((all) => all.map((x) => (x.email === s.email ? { ...x, role: v as Share['role'] } : x)));
                      });
                  }}
                >
                  <option value="edit">Editor</option>
                  <option value="view">Viewer</option>
                  <option value="remove">Remove access</option>
                </select>
              </li>
            ))}
          </ul>

          <h3 className="share-h">General access</h3>
          <div className="share-link-row">
            <span className={`share-link-icon${link === 'none' ? '' : ' on'}`}>{link === 'none' ? <Lock size={18} /> : <Globe size={18} />}</span>
            <div className="share-link-text">
              <select
                value={link}
                aria-label="General access"
                disabled={!cloudId}
                onChange={(e) => {
                  const v = e.target.value as LinkAccess;
                  run('Saving…', async () => {
                    await (await cloud()).setLinkAccess(cloudId!, v);
                    setLink(v);
                  });
                }}
              >
                <option value="none">Restricted</option>
                <option value="view">Anyone with the link can view</option>
                <option value="edit">Anyone with the link can edit</option>
              </select>
              <span className="muted small">
                {link === 'none'
                  ? 'Only people you added can open it with the link.'
                  : 'Anyone who signs in to Inkwell and has the link can open it.'}
              </span>
            </div>
          </div>

          {shares.length > 0 && (
            <p className="muted small share-note">
              <Mail size={14} /> Inkwell doesn’t email people for you. Send them the link:{' '}
              <a href={mailto}>write an email</a> or use <strong>Copy link</strong>. They sign in with the address you
              invited.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="muted small share-busy">
          <Loader2 size={14} className="spin" /> {busy}
        </p>
      )}
      {cloudId && (
        <div className="share-url">
          <input readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
          <button className="icon-btn sm" onClick={copy} aria-label="Copy link" title="Copy link">
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      )}
    </Modal>
  );
}
