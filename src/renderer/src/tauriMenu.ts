/**
 * Native menu of the Tauri build, mirroring `src/main/menu.ts`. Labels and shortcuts come from
 * `shared/commands.ts`, so the menu and the keyboard handling cannot drift apart.
 */
import { getVersion } from '@tauri-apps/api/app';
import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
  type PredefinedMenuItemOptions,
} from '@tauri-apps/api/menu';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { COMMANDS, type CommandDef } from '@shared/commands';

type Entry = MenuItem | PredefinedMenuItem | Submenu;
type Role = Exclude<PredefinedMenuItemOptions['item'], object>;

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export function createTauriMenu(
  os: 'darwin' | 'win32' | 'linux',
  dispatch: (command: string, arg?: string) => void,
): { setRecent(paths: string[]): void } {
  const mac = os === 'darwin';
  let zoom = 1;
  let recentMenu: Submenu | undefined;
  // Every menu call is an async IPC round trip: never let two updates interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (task: () => Promise<unknown>): void => {
    queue = queue.then(task).catch((e) => console.error('menu:', e));
  };

  const item = async (text: string, action: () => void, accelerator?: string) => {
    try {
      return await MenuItem.new({ text, accelerator, action });
    } catch {
      // An accelerator the native side cannot parse must not cost the whole menu.
      return MenuItem.new({ text, action });
    }
  };
  const cmd = (def: CommandDef) => item(def.label, () => dispatch(def.id), def.accelerator);
  const role = (name: Role) => PredefinedMenuItem.new({ item: name });
  const sep = () => role('Separator');
  const submenu = async (text: string, items: Array<Promise<Entry>>) =>
    Submenu.new({ text, items: await Promise.all(items) });

  const setZoom = (next: number): void => {
    zoom = next;
    void getCurrentWebview().setZoom(next);
  };
  const zoomBy = (dir: 1 | -1): void => {
    const i = ZOOM_STEPS.indexOf(zoom) + dir;
    setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i))]);
  };
  const toggleFullscreen = async (): Promise<void> => {
    const w = getCurrentWindow();
    await w.setFullscreen(!(await w.isFullscreen()));
  };

  const recentItems = (paths: string[]): Array<Promise<Entry>> => [
    ...paths.slice(0, 12).map((p) => item(baseName(p), () => dispatch('file.openRecent', p))),
    ...(paths.length ? [sep()] : []),
    item('Show All History', () => dispatch(COMMANDS.history.id)),
  ];

  enqueue(async () => {
    const about = PredefinedMenuItem.new({
      text: COMMANDS.about.label,
      item: {
        About: {
          name: 'OOXML Toolkit',
          version: await getVersion(),
          copyright: 'MIT License',
          comments: 'View, edit and compare OOXML packages.',
        },
      },
    });
    // Closing the only window runs the unsaved-changes check, then the app exits.
    const quit = item(
      mac ? 'Quit OOXML Toolkit' : 'Exit',
      () => void getCurrentWindow().close(),
      mac ? 'Cmd+Q' : undefined,
    );
    const recent = (recentMenu = await Submenu.new({
      text: 'Open Recent',
      items: await Promise.all(recentItems([])),
    }));
    const windowMenu = await submenu('Window', [
      role('Minimize'),
      role('Maximize'),
      ...(mac ? [sep(), role('BringAllToFront')] : []),
    ]);

    const items = await Promise.all([
      ...(mac
        ? [
            submenu('OOXML Toolkit', [
              about,
              sep(),
              cmd(COMMANDS.settings),
              sep(),
              role('Services'),
              sep(),
              role('Hide'),
              role('HideOthers'),
              role('ShowAll'),
              sep(),
              quit,
            ]),
          ]
        : []),
      submenu('File', [
        cmd(COMMANDS.open),
        Promise.resolve(recent),
        sep(),
        cmd(COMMANDS.save),
        cmd(COMMANDS.saveAs),
        sep(),
        cmd(COMMANDS.compare),
        cmd(COMMANDS.compareDisk),
        sep(),
        cmd(COMMANDS.reveal),
        cmd(COMMANDS.close),
        ...(mac ? [] : [sep(), cmd(COMMANDS.settings), quit]),
      ]),
      submenu('Edit', [
        cmd(COMMANDS.undo),
        cmd(COMMANDS.redo),
        sep(),
        role('Cut'),
        role('Copy'),
        role('Paste'),
        role('SelectAll'),
        sep(),
        cmd(COMMANDS.find),
        cmd(COMMANDS.searchAll),
        sep(),
        cmd(COMMANDS.formatXml),
        cmd(COMMANDS.toggleBookmark),
      ]),
      submenu('View', [
        cmd(COMMANDS.explorer),
        cmd(COMMANDS.bookmarks),
        cmd(COMMANDS.history),
        cmd(COMMANDS.problems),
        cmd(COMMANDS.toggleSidebar),
        sep(),
        cmd(COMMANDS.quickOpen),
        cmd(COMMANDS.navBack),
        cmd(COMMANDS.navForward),
        cmd(COMMANDS.nextTab),
        cmd(COMMANDS.prevTab),
        sep(),
        cmd(COMMANDS.toggleTheme),
        item('Actual Size', () => setZoom(1), 'CmdOrCtrl+0'),
        item('Zoom In', () => zoomBy(1), 'CmdOrCtrl+='),
        item('Zoom Out', () => zoomBy(-1), 'CmdOrCtrl+-'),
        mac ? role('Fullscreen') : item('Toggle Full Screen', () => void toggleFullscreen(), 'F11'),
      ]),
      Promise.resolve(windowMenu),
      ...(mac ? [] : [submenu('Help', [about])]),
    ]);
    if (mac) await windowMenu.setAsWindowsMenuForNSApp();
    await (await Menu.new({ items })).setAsAppMenu();
  });

  return {
    setRecent: (paths) =>
      enqueue(async () => {
        if (!recentMenu) return;
        for (const old of await recentMenu.items()) {
          await recentMenu.remove(old);
          await old.close();
        }
        await recentMenu.append(await Promise.all(recentItems(paths)));
      }),
  };
}
