import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Dropdown menu with nested submenus
// ---------------------------------------------------------------------------

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  onClick?: () => void;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  submenu?: MenuItem[];
  /** Custom content instead of a normal row (e.g. a colour grid) */
  render?: (close: () => void) => ReactNode;
}

interface MenuProps {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  align?: 'left' | 'right';
  className?: string;
  /** When true the menu opens on hover if another menu in the same bar is already open (menubar behaviour) */
  menubarGroup?: MenubarState;
  id?: string;
}

export interface MenubarState {
  active: string | null;
  setActive: (id: string | null) => void;
}

function MenuList({ items, close, style }: { items: MenuItem[]; close: () => void; style?: React.CSSProperties }) {
  const [openSub, setOpenSub] = useState<number | null>(null);
  return (
    <div className="menu" role="menu" style={style} onMouseDown={(e) => e.preventDefault()}>
      {items.map((item, i) => {
        if (item.divider) return <div key={i} className="menu-divider" />;
        if (item.render) return <div key={i}>{item.render(close)}</div>;
        const hasSub = !!item.submenu?.length;
        return (
          <div
            key={i}
            className="menu-row-wrap"
            onMouseEnter={() => setOpenSub(hasSub ? i : null)}
            onMouseLeave={() => hasSub && setOpenSub(null)}
          >
            <button
              type="button"
              role="menuitem"
              className={`menu-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                if (hasSub) {
                  setOpenSub(openSub === i ? null : i);
                  return;
                }
                close();
                item.onClick?.();
              }}
            >
              <span className="menu-icon">{item.checked ? <Check size={16} /> : item.icon}</span>
              <span className="menu-label">{item.label}</span>
              {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              {hasSub && <ChevronRight size={14} className="menu-chevron" />}
            </button>
            {hasSub && openSub === i && <MenuList items={item.submenu!} close={close} style={{}} />}
          </div>
        );
      })}
    </div>
  );
}

export function Menu({ trigger, items, align = 'left', className, menubarGroup, id }: MenuProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = menubarGroup ? menubarGroup.active === id : localOpen;
  const setOpen = useCallback(
    (v: boolean) => (menubarGroup ? menubarGroup.setActive(v ? id! : null) : setLocalOpen(v)),
    [menubarGroup, id],
  );
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const width = 260;
    let left = align === 'right' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 4, left, maxH: window.innerHeight - r.bottom - 16 });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || document.querySelector('.menu-portal')?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <div
      ref={ref}
      className={`menu-anchor ${className ?? ''}`}
      onMouseEnter={() => {
        if (menubarGroup && menubarGroup.active && menubarGroup.active !== id) menubarGroup.setActive(id!);
      }}
    >
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open &&
        pos &&
        createPortal(
          <div
            className={`menu-portal align-${align}`}
            style={{ top: pos.top, left: pos.left, ['--menu-max-h' as string]: `${pos.maxH}px` }}
          >
            <MenuList items={typeof items === 'function' ? items() : items} close={() => setOpen(false)} />
          </div>,
          document.body,
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal dialog
// ---------------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Prompt / confirm helpers (promise-based, styled)
// ---------------------------------------------------------------------------

type DialogReq =
  | { kind: 'prompt'; title: string; label?: string; value: string; ok: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; ok: string; danger?: boolean; resolve: (v: boolean) => void };

interface UICtx {
  toast: (msg: string) => void;
  prompt: (title: string, value?: string, opts?: { label?: string; ok?: string }) => Promise<string | null>;
  confirm: (title: string, message: string, opts?: { ok?: string; danger?: boolean }) => Promise<boolean>;
}

const Ctx = createContext<UICtx>(null!);
export const useUI = () => useContext(Ctx);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [dialog, setDialog] = useState<DialogReq | null>(null);
  const [value, setValue] = useState('');

  const toast = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const prompt = useCallback<UICtx['prompt']>(
    (title, v = '', opts = {}) =>
      new Promise((resolve) => {
        setValue(v);
        setDialog({ kind: 'prompt', title, label: opts.label, value: v, ok: opts.ok ?? 'OK', resolve });
      }),
    [],
  );
  const confirm = useCallback<UICtx['confirm']>(
    (title, message, opts = {}) =>
      new Promise((resolve) =>
        setDialog({ kind: 'confirm', title, message, ok: opts.ok ?? 'OK', danger: opts.danger, resolve }),
      ),
    [],
  );

  const finish = (result: string | boolean | null) => {
    if (!dialog) return;
    if (dialog.kind === 'prompt') dialog.resolve(result as string | null);
    else dialog.resolve(!!result);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ toast, prompt, confirm }}>
      {children}
      {dialog && (
        <Modal
          title={dialog.title}
          onClose={() => finish(dialog.kind === 'prompt' ? null : false)}
          width={420}
          footer={
            <>
              <button className="btn" onClick={() => finish(dialog.kind === 'prompt' ? null : false)}>
                Cancel
              </button>
              <button
                className={`btn ${dialog.kind === 'confirm' && dialog.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => finish(dialog.kind === 'prompt' ? value : true)}
              >
                {dialog.ok}
              </button>
            </>
          }
        >
          {dialog.kind === 'prompt' ? (
            <label className="field">
              {dialog.label && <span>{dialog.label}</span>}
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => e.key === 'Enter' && finish(value)}
              />
            </label>
          ) : (
            <p className="muted">{dialog.message}</p>
          )}
        </Modal>
      )}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              {t.msg}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const min = 60_000;
  if (diff < min) return 'just now';
  if (diff < 60 * min) return `${Math.floor(diff / min)} min ago`;
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (now.getFullYear() === d.getFullYear())
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
