// Inkwell desktop shell (macOS, Windows, Linux).
// Loads the same web app that runs on phones and in the browser, from local files,
// so it works completely offline.
const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron');
const path = require('node:path');

const isMac = process.platform === 'darwin';
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 500,
    title: 'Inkwell',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f4f5f7',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: !isMac, // the app has its own File/Edit/View menus; Alt shows the native one
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    }
  });

  // Right-click spelling suggestions
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    for (const s of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    }
    if (params.misspelledWord) {
      items.push({
        label: 'Add to dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { type: 'separator' }, { role: 'selectAll' });
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  mainWindow = win;
  win.on('closed', () => (mainWindow = null));
}

const template = [
  ...(isMac ? [{ role: 'appMenu' }] : []),
  {
    label: 'File',
    submenu: [
      {
        label: 'New Window',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => createWindow(),
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  },
  { role: 'editMenu' },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
  { role: 'windowMenu' },
  {
    role: 'help',
    submenu: [
      {
        label: 'Inkwell on GitHub',
        click: () => shell.openExternal('https://github.com/tkfam151/notetaking-app'),
      },
    ],
  },
];

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
