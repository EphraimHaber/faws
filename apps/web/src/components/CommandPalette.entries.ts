import type { LucideIcon } from "lucide-react";

import { AWS_SERVICES } from "~/services/registry";

/**
 * One row in the palette.
 *
 * `keywords` exists because a label is what a thing is called, not what someone
 * types to look for it. "Diagnostics" is the page's name; "logs" is the word in
 * the searcher's head. Matching only labels means the entry is unreachable by
 * the word that describes it.
 */
export interface PaletteEntry {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly hint: string;
  /** Extra words this entry should be findable by. Never shown. */
  readonly keywords: ReadonlyArray<string>;
  readonly group: PaletteGroup;
  run(): void;
}

export type PaletteGroup = "action" | "nav" | "resource";

/**
 * A nudge applied per group after text scoring.
 *
 * Small on purpose. The score ladder puts its tiers hundreds apart, so this can
 * only settle entries that already match about as well - and with no query at
 * all, where everything scores zero, it is what puts the things you do above
 * the places you go above the account's own contents. What it deliberately
 * cannot do is bury a cluster whose name you typed exactly under a page whose
 * name you did not.
 */
const GROUP_BOOST: Record<PaletteGroup, number> = {
  action: 30,
  nav: 20,
  resource: 0,
};

export function groupBoost(entry: PaletteEntry): number {
  return GROUP_BOOST[entry.group];
}

/** The strings an entry can be found by, best-matching one wins. */
export function entryText(entry: PaletteEntry): ReadonlyArray<string> {
  return [entry.label, entry.hint, ...entry.keywords];
}

/**
 * Every place in the app you can navigate to, from the service registry.
 *
 * Derived rather than listed, because a hardcoded copy drifts: EC2 had been a
 * built, sidebar-listed section for some time and had no palette entry at all,
 * so the one screen designed for "I know what I want, take me there" was the
 * one place you could not reach it from.
 *
 * Planned services are left out. The sidebar lists them so the gap is known;
 * offering a jump to a page that does not exist is a different thing.
 */
export function navEntries(navigate: (to: string) => void): PaletteEntry[] {
  const out: PaletteEntry[] = [
    {
      id: "nav:home",
      icon: AWS_SERVICES[0].icon,
      label: "Overview",
      hint: "account summary",
      keywords: ["home", "start", "dashboard"],
      group: "nav",
      run: () => navigate("/"),
    },
  ];

  for (const service of AWS_SERVICES) {
    if (service.status !== "available") continue;

    out.push({
      // The description rides as the hint rather than being split into
      // keywords. Split, each of its words became an exact match of its own,
      // so typing "instances" scored EC2's front door identically to EC2's
      // actual instance list and won on insertion order - the card page
      // beating the page with the rows on it. Whole, it can only ever be a
      // prefix or substring match, which is what a description should be.
      id: `nav:${service.id}`,
      icon: service.icon,
      label: service.label,
      hint: service.description,
      keywords: [service.id],
      group: "nav",
      run: () => navigate(service.basePath),
    });

    for (const section of service.sections) {
      const to = section.to ?? service.basePath;
      out.push({
        id: `nav:${service.id}:${section.id}`,
        icon: section.icon,
        label: section.label,
        hint: service.label.toLowerCase(),
        keywords: [service.id, section.id],
        group: "nav",
        run: () => navigate(to),
      });
    }
  }

  return out;
}

/** The shell's own pages, which belong to no AWS service. */
export function shellEntries(
  navigate: (to: string) => void,
  icons: { diagnostics: LucideIcon; settings: LucideIcon },
): PaletteEntry[] {
  return [
    {
      id: "nav:logs",
      icon: icons.diagnostics,
      label: "Diagnostics",
      hint: "faws server logs",
      keywords: ["logs", "errors", "debug", "trace"],
      group: "nav",
      run: () => navigate("/logs"),
    },
    {
      id: "nav:settings",
      icon: icons.settings,
      label: "Settings",
      hint: "preferences",
      keywords: ["preferences", "config", "theme", "endpoints", "profile"],
      group: "nav",
      run: () => navigate("/settings"),
    },
  ];
}
