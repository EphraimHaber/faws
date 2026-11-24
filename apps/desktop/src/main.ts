/**
 * faws desktop shell.
 *
 * Spawns the faws-server child process, waits for its port handshake on
 * stdout, then opens a BrowserWindow on the resulting URL (or the Vite dev
 * URL in dev). Quitting shuts the server down with it.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  session,
  shell,
  type MenuItemConstructorOptions,
} from "electron";

import { parseBackendPort } from "./backendPort.ts";
import { DEFAULT_NAV, type NavMenuItem, navMenuItems, sanitizeNavItems } from "./menu.ts";
import { followAppTrust } from "./trustStore.ts";
import {
  checkForUpdates,
  configureUpdates,
  downloadUpdate,
  installUpdate,
  onUpdateStatus,
  openReleases,
  updateStatus,
} from "./updater.ts";

const isDevelopment = Boolean(process.env["VITE_DEV_SERVER_URL"]);
const VITE_DEV_URL = process.env["VITE_DEV_SERVER_URL"] ?? "";

app.setName("faws");

let serverProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;
let mainWindow: BrowserWindow | null = null;
let serverOrigin = "";

function resolveServerEntry(): string {
  if (isDevelopment) return path.resolve(__dirname, "..", "..", "server", "src", "main.ts");
  return path.join(process.resourcesPath, "server", "main.mjs");
}

/** Where the server keeps logs and settings; the main process reads its trust store there. */
function dataDir(): string {
  return process.env["FAWS_DATA_DIR"] ?? app.getPath("userData");
}

function logFilePath(): string {
  return path.join(app.getPath("userData"), "logs", "faws-server.log");
}

function startServer(): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    // Electron's own binary doubles as the Node runtime, so end users don't
    // need a system `node` install.
    const child = spawn(process.execPath, [resolveServerEntry()], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: process.env["NODE_ENV"] ?? (isDevelopment ? "development" : "production"),
        FAWS_HOST: "127.0.0.1",
        FAWS_PORT: process.env["FAWS_PORT"] ?? "0",
        FAWS_DATA_DIR: dataDir(),
        ...(isDevelopment ? {} : { FAWS_WEB_DIST: path.join(process.resourcesPath, "web") }),
      },
    }) as ChildProcessByStdio<null, Readable, Readable>;

    serverProcess = child;
    let settled = false;

    createInterface({ input: child.stdout }).on("line", (line) => {
      process.stdout.write(`[faws-server] ${line}\n`);
      const port = parseBackendPort(line);
      if (port !== null && !settled) {
        settled = true;
        resolve({ port });
      }
    });
    createInterface({ input: child.stderr }).on("line", (line) => {
      process.stderr.write(`[faws-server] ${line}\n`);
    });

    child.on("exit", (code) => {
      if (!settled) reject(new Error(`faws-server exited before reporting a port (${code})`));
      if (mainWindow && !mainWindow.isDestroyed()) app.quit();
    });
    child.on("error", (err) => {
      if (!settled) reject(err);
    });
  });
}

function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    // The renderer draws its own header, so the native titlebar is reduced to
    // traffic lights inset over it. Positioning them explicitly centres the
    // group in our 48px header instead of letting macOS park them at the top
    // edge, where they sit on top of the brand mark.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    backgroundColor: "#16181d",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  // The header reserves space for the traffic lights, which macOS hides in
  // fullscreen - so the renderer has to know when to give that space back.
  const sendFullscreen = (fullscreen: boolean) =>
    window.webContents.send("faws:fullscreen", fullscreen);
  window.on("enter-full-screen", () => sendFullscreen(true));
  window.on("leave-full-screen", () => sendFullscreen(false));
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });
  void window.loadURL(url);
  return window;
}

/** Menu navigation posts to the server, which fans it out over Socket.IO. */
async function navigate(target: string): Promise<void> {
  if (!serverOrigin) return;
  try {
    await fetch(`${serverOrigin}/trpc/desktop.emitNav`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { target } }),
    });
  } catch (err) {
    process.stderr.write(`[faws] nav forward failed: ${String(err)}\n`);
  }
}

/** What the renderer last said the View menu should offer. */
let navItems: ReadonlyArray<NavMenuItem> = DEFAULT_NAV;

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...navMenuItems(navItems, (target) => void navigate(target)),
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "What's new", click: () => void navigate("/whats-new") },
        {
          label: "Check for updates…",
          click: () => {
            void navigate("/settings");
            void checkForUpdates();
          },
        },
        { type: "separator" },
        { label: "Open log file", click: () => void shell.openPath(logFilePath()) },
        {
          label: "Reveal logs folder",
          click: () => shell.showItemInFolder(logFilePath()),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Update check: the window asks, the main process answers and then reports
// every change of state on "faws:update-status" until the window goes away.
ipcMain.handle("faws:update-status", () => updateStatus());
ipcMain.handle("faws:update-check", () => checkForUpdates());
ipcMain.handle("faws:update-download", () => downloadUpdate());
ipcMain.handle("faws:update-install", () => installUpdate());
ipcMain.handle("faws:update-open-release", () => openReleases());
ipcMain.on("faws:update-configure", (_event, raw: unknown) => {
  const config = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  configureUpdates({
    autoCheck: config["autoCheck"] === true,
    channel: config["channel"] === "beta" ? "beta" : "stable",
  });
});
onUpdateStatus((status) => {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("faws:update-status", status);
});

ipcMain.on("faws:set-nav", (_event, raw: unknown) => {
  navItems = sanitizeNavItems(raw);
  buildMenu();
});
ipcMain.handle("faws:open-log-file", () => shell.openPath(logFilePath()));
/** Opens a web page in the default browser, such as a cluster's sign in page; nothing but http(s). */
ipcMain.handle("faws:open-external", async (_event, raw: unknown) => {
  if (typeof raw !== "string") return;
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return;
  }
  if (target.protocol === "https:" || target.protocol === "http:") {
    await shell.openExternal(target.toString());
  }
});
ipcMain.handle("faws:show-log-dir", () => {
  const file = logFilePath();
  if (fs.existsSync(file)) shell.showItemInFolder(file);
  else void shell.openPath(path.dirname(file));
});

/**
 * In dev the dev-runner already has a server on FAWS_PORT, so the shell
 * attaches to it instead of starting a second one. Packaged builds always
 * own their server.
 */
async function resolveServer(): Promise<number> {
  const devPort = isDevelopment ? Number(process.env["FAWS_PORT"]) : Number.NaN;
  if (Number.isInteger(devPort) && devPort > 0) return devPort;
  const { port } = await startServer();
  return port;
}

void app.whenReady().then(async () => {
  // Before any request: the window and the updater (its own "electron-updater"
  // partition) honour the same certificates the server does.
  followAppTrust(dataDir(), [
    session.defaultSession,
    session.fromPartition("electron-updater", { cache: false }),
  ]);
  const port = await resolveServer();
  serverOrigin = `http://127.0.0.1:${port}`;
  buildMenu();
  mainWindow = createWindow(isDevelopment ? VITE_DEV_URL : serverOrigin);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(isDevelopment ? VITE_DEV_URL : serverOrigin);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill();
});
