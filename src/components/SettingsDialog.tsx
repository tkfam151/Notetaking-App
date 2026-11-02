import { Monitor, Moon, Sun } from 'lucide-react';
import { exportBackup, importBackup } from '../lib/db';
import { pickFile, saveFile } from '../lib/platform';
import type { Settings } from '../types';
import { Modal, useUI } from './ui';

export function SettingsDialog({
  settings,
  update,
  onClose,
  onDataChanged,
}: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  onClose: () => void;
  onDataChanged?: () => void;
}) {
  const ui = useUI();
  const backup = async () => {
    const data = await exportBackup();
    const date = new Date().toISOString().slice(0, 10);
    await saveFile(`inkwell-backup-${date}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
  };
  const restore = async () => {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.app !== 'inkwell') throw new Error();
      const n = await importBackup(data);
      ui.toast(`Restored ${n} document${n === 1 ? '' : 's'}`);
      onDataChanged?.();
    } catch {
      ui.toast('That file is not an Inkwell backup');
    }
  };

  return (
    <Modal title="Settings" onClose={onClose} width={520}>
      <div className="settings">
        <section>
          <h3>Appearance</h3>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {(
              [
                ['light', 'Light', <Sun size={16} key="l" />],
                ['dark', 'Dark', <Moon size={16} key="d" />],
                ['system', 'System', <Monitor size={16} key="s" />],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                role="radio"
                aria-checked={settings.theme === id}
                className={settings.theme === id ? 'active' : ''}
                onClick={() => update({ theme: id })}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Editing</h3>
          <label className="field">
            <span>Your name (shown on comments)</span>
            <input value={settings.authorName} onChange={(e) => update({ authorName: e.target.value })} />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.spellcheck}
              onChange={(e) => update({ spellcheck: e.target.checked })}
            />
            Check spelling as I type
          </label>
        </section>
        <section>
          <h3>Backup</h3>
          <p className="muted small">
            Your documents are stored privately on this device. Download a backup to move them to another device.
          </p>
          <div className="row gap">
            <button className="btn" onClick={backup}>
              Download backup
            </button>
            <button className="btn" onClick={restore}>
              Restore from backup…
            </button>
          </div>
        </section>
        <section>
          <h3>About</h3>
          <p className="muted small">Inkwell {__APP_VERSION__} · Works offline · Your files never leave your device.</p>
        </section>
      </div>
    </Modal>
  );
}
