import { ChevronLeft, ChevronRight, Pause, Play, QrCode } from "lucide-react";
import * as React from "react";

import { Segmented } from "~/components/segmented";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { Panel, PanelHeader, PanelTitle } from "~/components/ui/panel";
import {
  DEFAULT_QR_PRESET,
  encodeQr,
  MAX_QR_VERSION,
  MIN_QR_VERSION,
  modulesForVersion,
  planQr,
  QR_LEVEL_LABELS,
  QR_LEVELS,
  QR_PRESETS,
  qrPath,
  type QrLevel,
} from "~/features/tools/qr";

/** Past this many codes, scanning them one by one stops being a sane way to move the text. */
const MANY_PARTS = 30;

const QUIET_ZONE = 4;

const INTERVALS = [
  { value: "800", label: "0.8s" },
  { value: "1500", label: "1.5s" },
  { value: "3000", label: "3s" },
] as const;
type Interval = (typeof INTERVALS)[number]["value"];

type PresetId = (typeof QR_PRESETS)[number]["id"] | "custom";

export function QrPage() {
  const [text, setText] = React.useState("");
  const [version, setVersion] = React.useState<number>(DEFAULT_QR_PRESET.version);
  const [level, setLevel] = React.useState<QrLevel>(DEFAULT_QR_PRESET.level);
  const [header, setHeader] = React.useState(true);
  const [index, setIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [interval, setIntervalMs] = React.useState<Interval>("1500");

  const deferredText = React.useDeferredValue(text);
  const plan = React.useMemo(
    () => planQr(deferredText, { version, level, header }),
    [deferredText, version, level, header],
  );
  const count = plan.parts.length;
  const current = Math.min(index, Math.max(0, count - 1));
  const part = plan.parts[current];

  const matrix = React.useMemo(
    () => (part === undefined ? undefined : encodeQr(part, version, level)),
    [part, version, level],
  );

  React.useEffect(() => {
    if (!playing || count < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), Number(interval));
    return () => window.clearInterval(id);
  }, [playing, count, interval]);

  const preset: PresetId =
    QR_PRESETS.find((p) => p.version === version && p.level === level)?.id ?? "custom";

  const step = (delta: number) => {
    setPlaying(false);
    setIndex((current + delta + count) % count);
  };

  return (
    <Panel className="flex-1 overflow-hidden">
      <PanelHeader>
        <PanelTitle>Text to QR</PanelTitle>
        <span className="font-mono text-[11px] text-muted-foreground tabular">
          {plan.totalBytes} B · {plan.capacity} B per code · {count}{" "}
          {count === 1 ? "code" : "codes"}
        </span>
      </PanelHeader>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium">Text</span>
            <textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setIndex(0);
              }}
              placeholder="Paste the text to send…"
              spellCheck={false}
              rows={10}
              className="min-h-40 w-full resize-y rounded-md border border-border bg-card/60 px-2.5 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </label>

          <Setting label="Preset">
            <Segmented<PresetId>
              options={[
                ...QR_PRESETS.map((p) => ({ value: p.id, label: p.label })),
                ...(preset === "custom" ? [{ value: "custom" as const, label: "Custom" }] : []),
              ]}
              value={preset}
              onChange={(next) => {
                const match = QR_PRESETS.find((p) => p.id === next);
                if (!match) return;
                setVersion(match.version);
                setLevel(match.level);
                setIndex(0);
              }}
              className="self-start"
            />
          </Setting>

          <Setting
            label="Largest code"
            hint={`version ${version} · ${modulesForVersion(version)}×${modulesForVersion(version)} modules. Smaller scans more easily and holds less.`}
          >
            <input
              type="range"
              min={MIN_QR_VERSION}
              max={MAX_QR_VERSION}
              value={version}
              aria-label="Largest QR version"
              onChange={(event) => {
                setVersion(Number(event.target.value));
                setIndex(0);
              }}
              className="w-full max-w-80 accent-primary"
            />
          </Setting>

          <Setting
            label="Error correction"
            hint="How much of the code can be damaged or blurred and still read. Higher holds less."
          >
            <Segmented<QrLevel>
              options={QR_LEVELS.map((value) => ({ value, label: QR_LEVEL_LABELS[value] }))}
              value={level}
              onChange={(next) => {
                setLevel(next);
                setIndex(0);
              }}
              className="self-start"
            />
          </Setting>

          <label className="flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={header}
              onChange={(event) => setHeader(event.target.checked)}
              className="mt-0.5 size-3.5 cursor-pointer accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Number the parts</span>
              <span className="text-muted-foreground">
                Prefixes each code with [n/total] when the text needs more than one, so the order
                survives a missed or repeated scan.
              </span>
            </span>
          </label>
        </div>

        <div className="flex min-w-0 flex-col items-center gap-3">
          {matrix ? (
            <>
              <svg
                viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${matrix.size + QUIET_ZONE * 2} ${matrix.size + QUIET_ZONE * 2}`}
                shapeRendering="crispEdges"
                role="img"
                aria-label={`QR code ${current + 1} of ${count}`}
                className="aspect-square w-full max-w-[min(100%,520px)] rounded-md"
              >
                {/* always dark on white: inverted or tinted codes fail on many scanners */}
                <rect
                  x={-QUIET_ZONE}
                  y={-QUIET_ZONE}
                  width={matrix.size + QUIET_ZONE * 2}
                  height={matrix.size + QUIET_ZONE * 2}
                  fill="#fff"
                />
                <path d={qrPath(matrix)} fill="#000" />
              </svg>

              <div className="flex flex-wrap items-center justify-center gap-2">
                {count > 1 ? (
                  <>
                    <Button size="icon" aria-label="Previous code" onClick={() => step(-1)}>
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <span className="min-w-16 text-center font-mono text-[12px] tabular">
                      {current + 1} / {count}
                    </span>
                    <Button size="icon" aria-label="Next code" onClick={() => step(1)}>
                      <ChevronRight className="size-3.5" />
                    </Button>
                    <Button onClick={() => setPlaying((p) => !p)}>
                      {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                      {playing ? "Pause" : "Cycle"}
                    </Button>
                    <Segmented<Interval>
                      options={INTERVALS}
                      value={interval}
                      onChange={setIntervalMs}
                    />
                  </>
                ) : null}
                <CopyButton value={part ?? ""} label="Copy this part" />
              </div>

              <span className="font-mono text-[11px] text-muted-foreground tabular">
                version {matrix.version} · {matrix.size}×{matrix.size}
              </span>

              {count > MANY_PARTS ? (
                <p className="max-w-md text-center text-[12px] text-warning">
                  {count} codes is a lot to scan. A larger code or lower error correction cuts the
                  count; a file transfer may be the better tool for this much text.
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={QrCode}
              title="Nothing to encode"
              hint="Paste text to see its code."
            />
          )}
        </div>
      </div>
    </Panel>
  );
}

function Setting({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium">{label}</span>
      {children}
      {hint ? <span className="text-[11.5px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
