import { Sparkles } from "lucide-react";

import { Markdown } from "~/components/markdown";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { CHANGELOG, compareVersions } from "~/lib/changelog";
import { cn } from "~/lib/utils";

/**
 * Every release's notes, newest first, from the changelog bundled with this
 * build. The running version is marked; anything above it is a newer release
 * this build happens to know about only if it was built from a later tree.
 */
export function WhatsNewPage() {
  const current = import.meta.env.APP_VERSION;

  if (CHANGELOG.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No releases yet"
        hint={`This is ${current === "0.0.0" ? "an unreleased build" : `version ${current}`}; release notes appear here once a version ships.`}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {CHANGELOG.map((release) => {
        const running = compareVersions(release.version, current) === 0;
        return (
          <Panel key={release.version} className={cn("shrink-0", running && "border-primary/40")}>
            <PanelHeader>
              <PanelTitle>faws {release.version}</PanelTitle>
              {running ? <Badge tone="primary">running</Badge> : null}
            </PanelHeader>
            <div className="flex flex-col gap-4 px-3.5 py-3">
              {release.sections.map((section) => (
                <section key={section.title} className="flex flex-col gap-2">
                  <h3 className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                    {section.title.replace(/ Changes$/, "")}
                  </h3>
                  <ul className="flex flex-col gap-2 text-[12.5px] leading-relaxed">
                    {section.entries.map((entry) => (
                      <li key={entry.text} className="flex gap-2">
                        <span
                          aria-hidden
                          className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50"
                        />
                        <Markdown source={entry.text} className="min-w-0" />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
