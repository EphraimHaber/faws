import * as React from "react";

import { type DesktopNavItem, desktopBridge } from "~/lib/desktop";
import { HOST_SERVICES, PROVIDERS, type NavRuntime, visibleSections } from "~/services/registry";
import { useEnabledProviders } from "~/stores/scope";

/**
 * Keeps the desktop app's View menu in step with the providers that are on.
 *
 * The menu is built in the main process, which knows nothing about settings,
 * so the renderer sends the destinations whenever they change. Outside the
 * desktop shell this does nothing.
 */
export function useDesktopMenu(runtime: NavRuntime): void {
  const enabled = useEnabledProviders();

  const items = React.useMemo(() => {
    const out: DesktopNavItem[] = [];
    const add = (group: string, services: typeof HOST_SERVICES) => {
      for (const service of services) {
        if (service.status !== "available") continue;
        const sections = visibleSections(service, runtime).filter((section) => section.to);
        if (sections.length === 0)
          out.push({ label: service.label, target: service.basePath, group });
        for (const section of sections) {
          out.push({ label: section.label, target: section.to!, group });
        }
      }
    };
    for (const provider of PROVIDERS) {
      if (enabled.includes(provider.id)) add(provider.id, provider.services);
    }
    add("host", HOST_SERVICES);
    out.push({ label: "Diagnostics", target: "/logs", group: "app" });
    out.push({ label: "Settings", target: "/settings", group: "app" });
    return out;
  }, [enabled, runtime]);

  React.useEffect(() => {
    desktopBridge()?.setNavMenu?.(items);
  }, [items]);
}
