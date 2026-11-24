/**
 * The View menu's destinations, as the renderer last described them.
 *
 * The renderer owns which providers are on, so it sends the list and the main
 * process only lays it out. What arrives is checked before it reaches the
 * menu: it crossed a process boundary, and a menu item that navigates is a
 * thing a compromised page should not be able to point anywhere but a path.
 */
import type { MenuItemConstructorOptions } from "electron";

export interface NavMenuItem {
  readonly label: string;
  /** An in-app path, always starting with `/`. */
  readonly target: string;
  /** Items with the same group sit together, under a separator. */
  readonly group: string;
}

/** Before the renderer has said anything: the pages every install has. */
export const DEFAULT_NAV: ReadonlyArray<NavMenuItem> = [
  { label: "Diagnostics", target: "/logs", group: "app" },
  { label: "Settings", target: "/settings", group: "app" },
];

const MAX_ITEMS = 40;

export function sanitizeNavItems(raw: unknown): NavMenuItem[] {
  if (!Array.isArray(raw)) return [...DEFAULT_NAV];
  const items: NavMenuItem[] = [];
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { label, target, group } = entry as Record<string, unknown>;
    if (typeof label !== "string" || label.length === 0 || label.length > 80) continue;
    if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//")) continue;
    items.push({ label, target, group: typeof group === "string" ? group : "app" });
  }
  return items;
}

/**
 * Overview on Cmd+0, the first nine destinations on Cmd+1 to Cmd+9 in the
 * order they arrive, and Settings on Cmd+, wherever it falls.
 */
export function navMenuItems(
  items: ReadonlyArray<NavMenuItem>,
  navigate: (target: string) => void,
): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = [
    { label: "Overview", accelerator: "CmdOrCtrl+0", click: () => navigate("/") },
  ];
  let digit = 1;
  let group: string | null = null;
  for (const item of items) {
    if (item.group !== group) {
      out.push({ type: "separator" });
      group = item.group;
    }
    const accelerator =
      item.target === "/settings"
        ? "CmdOrCtrl+,"
        : digit <= 9 && item.group !== "app"
          ? `CmdOrCtrl+${digit++}`
          : undefined;
    out.push({
      label: item.label,
      ...(accelerator ? { accelerator } : {}),
      click: () => navigate(item.target),
    });
  }
  return out;
}
