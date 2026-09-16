/**
 * Preload bridge.
 *
 * Everything the renderer needs from AWS goes over tRPC to the server, so the
 * bridge only carries what genuinely requires Electron main: the log file
 * helpers and the platform flag the renderer uses for its titlebar padding.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const faws = {
  platform: process.platform,
  openLogFile: () => ipcRenderer.invoke("faws:open-log-file") as Promise<void>,
  showLogDir: () => ipcRenderer.invoke("faws:show-log-dir") as Promise<void>,
  /** Fires on every fullscreen transition; returns an unsubscribe function. */
  onFullscreenChange: (listener: (fullscreen: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, fullscreen: boolean) => listener(fullscreen);
    ipcRenderer.on("faws:fullscreen", handler);
    return () => ipcRenderer.off("faws:fullscreen", handler);
  },
};

contextBridge.exposeInMainWorld("faws", faws);

export type FawsBridge = typeof faws;
