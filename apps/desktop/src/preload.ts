/**
 * Preload bridge.
 *
 * Everything the renderer needs from AWS goes over tRPC to the server, so the
 * bridge only carries what genuinely requires Electron main: the log file
 * helpers, the app menu's destinations, the update check and the platform
 * flag the renderer uses for its titlebar padding.
 */
import type { UpdateConfig, UpdateStatus } from "@faws/contracts";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const faws = {
  platform: process.platform,
  openLogFile: () => ipcRenderer.invoke("faws:open-log-file") as Promise<void>,
  showLogDir: () => ipcRenderer.invoke("faws:show-log-dir") as Promise<void>,
  /** Opens an http(s) page in the default browser. */
  openExternal: (url: string) => ipcRenderer.invoke("faws:open-external", url) as Promise<void>,
  /** Replaces the View menu's destinations; the main process checks every one. */
  setNavMenu: (items: ReadonlyArray<{ label: string; target: string; group: string }>) =>
    ipcRenderer.send("faws:set-nav", items),
  /** Fires on every fullscreen transition; returns an unsubscribe function. */
  onFullscreenChange: (listener: (fullscreen: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, fullscreen: boolean) => listener(fullscreen);
    ipcRenderer.on("faws:fullscreen", handler);
    return () => ipcRenderer.off("faws:fullscreen", handler);
  },
  updates: {
    status: () => ipcRenderer.invoke("faws:update-status") as Promise<UpdateStatus>,
    check: () => ipcRenderer.invoke("faws:update-check") as Promise<UpdateStatus>,
    download: () => ipcRenderer.invoke("faws:update-download") as Promise<void>,
    install: () => ipcRenderer.invoke("faws:update-install") as Promise<void>,
    openRelease: () => ipcRenderer.invoke("faws:update-open-release") as Promise<void>,
    configure: (config: UpdateConfig) => ipcRenderer.send("faws:update-configure", config),
    /** Fires on every change of update state; returns an unsubscribe function. */
    onStatus: (listener: (status: UpdateStatus) => void) => {
      const handler = (_event: IpcRendererEvent, status: UpdateStatus) => listener(status);
      ipcRenderer.on("faws:update-status", handler);
      return () => ipcRenderer.off("faws:update-status", handler);
    },
  },
};

contextBridge.exposeInMainWorld("faws", faws);

export type FawsBridge = typeof faws;
