import { BrowserWindow, Menu, app, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { COMMANDS, type CommandDef } from '../shared/commands';
import { IPC } from '../shared/api';

const isMac = process.platform === 'darwin';

function send(win: BrowserWindow | undefined, command: string, arg?: string): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.evCommand, command, arg);
}

export function buildMenu(recent: string[]): void {
  const cmd = (
    def: CommandDef,
    extra: Partial<MenuItemConstructorOptions> = {},
  ): MenuItemConstructorOptions => ({
    label: def.label,
    accelerator: def.accelerator,
    click: (_item, win) =>
      send(
        (win as BrowserWindow | undefined) ?? BrowserWindow.getFocusedWindow() ?? undefined,
        def.id,
      ),
    ...extra,
  });

  const openRecent: MenuItemConstructorOptions = {
    label: 'Open Recent',
    submenu: [
      ...recent.slice(0, 12).map((p): MenuItemConstructorOptions => ({
        label: path.basename(p),
        sublabel: path.dirname(p),
        click: (_i, win) =>
          send((win as BrowserWindow | undefined) ?? undefined, 'file.openRecent', p),
      })),
      ...(recent.length ? [{ type: 'separator' as const }] : []),
      {
        label: 'Show All History',
        click: (_i, win) =>
          send((win as BrowserWindow | undefined) ?? undefined, COMMANDS.history.id),
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              cmd(COMMANDS.about, { click: () => app.showAboutPanel() }),
              { type: 'separator' },
              cmd(COMMANDS.settings),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        cmd(COMMANDS.open),
        openRecent,
        { type: 'separator' },
        cmd(COMMANDS.save),
        cmd(COMMANDS.saveAs),
        cmd(COMMANDS.reload),
        { type: 'separator' },
        cmd(COMMANDS.compare),
        cmd(COMMANDS.compareDisk),
        { type: 'separator' },
        cmd(COMMANDS.reveal),
        cmd(COMMANDS.close),
        ...(isMac
          ? []
          : ([
              { type: 'separator' },
              cmd(COMMANDS.settings),
              { role: 'quit' },
            ] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        cmd(COMMANDS.undo),
        cmd(COMMANDS.redo),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        cmd(COMMANDS.find),
        cmd(COMMANDS.searchAll),
        { type: 'separator' },
        cmd(COMMANDS.formatXml),
        cmd(COMMANDS.toggleBookmark),
      ],
    },
    {
      label: 'View',
      submenu: [
        cmd(COMMANDS.explorer),
        cmd(COMMANDS.bookmarks),
        cmd(COMMANDS.history),
        cmd(COMMANDS.problems),
        cmd(COMMANDS.toggleSidebar),
        { type: 'separator' },
        cmd(COMMANDS.quickOpen),
        cmd(COMMANDS.navBack),
        cmd(COMMANDS.navForward),
        cmd(COMMANDS.nextTab),
        cmd(COMMANDS.prevTab),
        { type: 'separator' },
        cmd(COMMANDS.toggleTheme),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged
          ? []
          : ([
              { type: 'separator' },
              { role: 'reload' },
              { role: 'toggleDevTools' },
            ] as MenuItemConstructorOptions[])),
      ],
    },
    { role: 'windowMenu' },
    ...(isMac
      ? []
      : ([
          { label: 'Help', submenu: [cmd(COMMANDS.about, { click: () => app.showAboutPanel() })] },
        ] as MenuItemConstructorOptions[])),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
