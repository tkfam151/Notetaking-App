import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'web' | 'ios' | 'android'
export const isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Save a file in the most natural way for the current platform:
 * - Web / Electron: a normal download (Electron shows a "Save as" dialog)
 * - iOS / Android: write to the app's cache and open the system share sheet,
 *   so the user can save it to Files, Drive, email it, etc.
 */
export async function saveFile(filename: string, blob: Blob) {
  if (isNative) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const data = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    await Share.share({ title: filename, url: res.uri, dialogTitle: 'Save or share' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens the system file picker and resolves with the chosen file (or null). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    // If the picker is cancelled no event fires in some browsers; that's fine.
    document.body.appendChild(input);
    input.click();
  });
}

export function safeFilename(name: string) {
  return (name.trim() || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
}
