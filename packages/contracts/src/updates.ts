/**
 * What the desktop app's update check knows, as the main process reports it
 * to the window over the preload bridge.
 */
export type UpdateState =
  /** Nothing asked yet. */
  | "idle"
  | "checking"
  | "up-to-date"
  /** A newer version exists; `version` says which. */
  | "available"
  | "downloading"
  /** Downloaded and ready; restarting installs it. */
  | "ready"
  | "error"
  /** This build cannot update itself: a development build, or a plain browser. */
  | "unsupported";

export interface UpdateStatus {
  readonly state: UpdateState;
  /** The version running now. */
  readonly currentVersion: string;
  /** The newer version, once one is known. */
  readonly version: string | null;
  /** Markdown notes of the newer version, as its release carries them. */
  readonly releaseNotes: string | null;
  /** The release's page, for platforms that update by downloading by hand. */
  readonly releaseUrl: string | null;
  /** 0 to 100 while downloading. */
  readonly progress: number | null;
  readonly error: string | null;
  /** ISO time of the last finished check. */
  readonly checkedAt: string | null;
  /**
   * Whether this platform installs in place. False on macOS, where an
   * unsigned app cannot replace itself: the release page is offered instead.
   */
  readonly canInstall: boolean;
  /** Why the state is `unsupported`, when it is. */
  readonly reason: string | null;
}

export interface UpdateConfig {
  readonly autoCheck: boolean;
  readonly channel: "stable" | "beta";
}
