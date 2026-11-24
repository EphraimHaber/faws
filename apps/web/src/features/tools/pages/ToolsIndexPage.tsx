import { QrCode } from "lucide-react";

import { SectionCard } from "~/components/section-card";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import { byteCapacity, MAX_QR_VERSION } from "~/features/tools/qr";

export function ToolsIndexPage() {
  return (
    <Panel className="flex-1">
      <PanelHeader>
        <PanelTitle>Tools</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground">
          offline, no account needed
        </span>
      </PanelHeader>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        <SectionCard
          to="/tools/qr"
          icon={QrCode}
          label="Text to QR"
          description="Paste text and read it on another device through its camera, split across as many codes as it takes."
          metric={String(byteCapacity(MAX_QR_VERSION, "L"))}
          metricLabel="bytes max per code"
        />
      </div>
    </Panel>
  );
}
