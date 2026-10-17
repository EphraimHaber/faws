import {
  CLOUDWATCH_WINDOWS,
  type CloudWatchWindow,
  DEFAULT_CLOUDWATCH_WINDOW,
  type RestApiStage,
} from "@faws/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ScrollText } from "lucide-react";
import * as React from "react";

import { Segmented } from "~/components/segmented";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty";
import { ErrorState } from "~/components/ui/error-state";
import { LoadingRows, Spinner } from "~/components/ui/spinner";
import { useAwsScope, useScope } from "~/contexts/ScopeContext";
import { StageSelect, useStageLogSources } from "~/features/api-gateway/components/parts";
import {
  type AccessLogSource,
  STAGE_LOG_KINDS,
  type StageLogKind,
} from "~/features/api-gateway/stages";
import {
  type LogOrder,
  LogViewControls,
  tailPolling,
  useFollowNewest,
  useShownSearch,
} from "~/features/cloudwatch/components/LogLines";
import { LogWindowView, WindowPicker } from "~/features/cloudwatch/components/LogWindow";
import { LogFilterBar } from "~/features/ecs/components/LogFilterBar";
import { parseText, useSearchState } from "~/hooks/useSearchState";
import { stripAnsi } from "~/lib/ansi";
import { trpc } from "~/lib/trpc";

const KIND_LABELS: Record<StageLogKind, string> = {
  access: "Access",
  execution: "Execution",
};

/**
 * One stage's access or execution logs, read in place. The stage, the kind
 * and the window ride in the URL; the filter does not, since every apply is a
 * billed query. Where there is nothing to read, a sentence says why.
 */
export function LogsPane({ apiId }: { apiId: string }) {
  const scope = useAwsScope();
  const [picked, setPicked] = useSearchState<string>({
    key: "stage",
    fallback: "",
    parse: parseText,
  });
  const [kind, setKind] = useSearchState<StageLogKind>({
    key: "log",
    fallback: "access",
    parse: (raw) => STAGE_LOG_KINDS.find((value) => value === raw) ?? "access",
  });

  const stages = useQuery(trpc.apiGateway.stages.queryOptions({ ...scope, apiId }));

  if (stages.isPending) return <LoadingRows rows={8} />;
  if (stages.isError) {
    return <ErrorState error={stages.error} onRetry={() => void stages.refetch()} />;
  }
  const stage = stages.data.find((entry) => entry.name === picked) ?? stages.data[0];
  if (!stage) {
    return (
      <EmptyState
        icon={ScrollText}
        title="This API has no stages, so nothing logs"
        hint="Logs are written by a stage, once a deployment is put on one."
      />
    );
  }

  return (
    <StageLogs
      apiId={apiId}
      stage={stage}
      stageNames={stages.data.map((entry) => entry.name)}
      onStage={setPicked}
      kind={kind}
      onKind={setKind}
    />
  );
}

function StageLogs({
  apiId,
  stage,
  stageNames,
  onStage,
  kind,
  onKind,
}: {
  apiId: string;
  stage: RestApiStage;
  stageNames: ReadonlyArray<string>;
  onStage: (name: string) => void;
  kind: StageLogKind;
  onKind: (kind: StageLogKind) => void;
}) {
  const scope = useAwsScope();
  const [windowMinutes, setWindowMinutes] = useSearchState<CloudWatchWindow>({
    key: "window",
    fallback: DEFAULT_CLOUDWATCH_WINDOW,
    parse: (raw) =>
      CLOUDWATCH_WINDOWS.find((minutes) => minutes === Number(raw)) ?? DEFAULT_CLOUDWATCH_WINDOW,
  });
  const { access, execution } = useStageLogSources(apiId, stage);

  // The execution group is looked for even with logging off, since what it
  // wrote while logging was on stays until it expires.
  const group =
    kind === "execution" ? execution.name : access.kind === "group" ? access.name : null;
  const loggingOn = kind === "execution" ? execution.kind === "group" : access.kind === "group";

  const described = useQuery({
    ...trpc.cloudwatch.logGroup.queryOptions({ ...scope, logGroup: group ?? "" }),
    enabled: group !== null,
  });
  const account = useQuery({
    ...trpc.apiGateway.account.queryOptions(scope),
    enabled: loggingOn,
    staleTime: 60_000,
  });
  // Only a read that came back without a role says there is none; a failed
  // read says nothing either way.
  const noRole = loggingOn && account.data?.cloudwatchRoleArn === null;
  const found = described.data ?? null;

  const kindLabel = KIND_LABELS[kind];
  const noRoleSentence = `API Gateway has no CloudWatch role in ${scope.region}, so it cannot write logs for any stage until one is set in its account settings.`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2">
        <StageSelect value={stage.name} names={stageNames} onChange={onStage} />
        <Segmented<StageLogKind>
          value={kind}
          onChange={onKind}
          options={STAGE_LOG_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))}
        />
        {described.isFetching ? <Spinner /> : null}
        {found ? (
          <Link
            to="/cloudwatch/log-groups/$group"
            params={{ group: found.name }}
            search={{ window: windowMinutes }}
            title={`Open ${found.name} in CloudWatch`}
            className="ml-auto inline-flex min-w-0 items-center gap-1 font-mono text-[10.5px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-primary"
          >
            <span className="truncate">{found.name}</span>
            <ArrowUpRight className="size-3 shrink-0" />
          </Link>
        ) : null}
      </div>

      {kind === "access" && access.kind !== "group" ? (
        <AccessElsewhere access={access} stageName={stage.name} />
      ) : group === null ? null : described.isPending ? (
        <LoadingRows rows={8} />
      ) : described.isError ? (
        <ErrorState error={described.error} onRetry={() => void described.refetch()} />
      ) : !found ? (
        loggingOn ? (
          // Which reason the hint gives depends on the account read, so it
          // waits for it rather than showing one reason and then the other.
          account.isPending ? (
            <LoadingRows rows={8} />
          ) : (
            <EmptyState
              icon={ScrollText}
              title={`${kindLabel} logging is on for stage ${stage.name}, but its log group does not exist`}
              hint={
                noRole
                  ? noRoleSentence
                  : kind === "execution"
                    ? `API Gateway makes ${group} with the first request it logs, so the stage may not have been called since logging was turned on.`
                    : `Nothing may have been logged since logging was turned on, or ${group} was deleted.`
              }
            />
          )
        ) : (
          <EmptyState
            icon={ScrollText}
            title={`Execution logging is off for stage ${stage.name}`}
            hint={`When it is on, API Gateway writes to ${group}.`}
          />
        )
      ) : (
        <>
          {loggingOn ? null : (
            <p className="border-b border-border px-3.5 py-1.5 text-[11.5px] text-muted-foreground">
              Execution logging is off for stage {stage.name} now; these are the lines it wrote
              while it was on.
            </p>
          )}
          {noRole ? (
            <p className="border-b border-border bg-warning/8 px-3.5 py-1.5 text-[11.5px] text-warning">
              {noRoleSentence}
            </p>
          ) : null}
          <LogReader
            // A filter, tail or order chosen for one group does not carry to the next.
            key={found.name}
            group={found.name}
            windowMinutes={windowMinutes}
            onWindow={setWindowMinutes}
          />
        </>
      )}
    </div>
  );
}

/** Says why access logs that are off, or kept outside the scope, are not shown. */
function AccessElsewhere({
  access,
  stageName,
}: {
  access: Exclude<AccessLogSource, { kind: "group" }>;
  stageName: string;
}) {
  const { region } = useScope();
  if (access.kind === "off") {
    return <EmptyState icon={ScrollText} title={`Access logging is off for stage ${stageName}`} />;
  }
  if (access.kind === "not-cloudwatch") {
    const firehose = access.arn.split(":")[2] === "firehose";
    return (
      <EmptyState
        icon={ScrollText}
        title={`Access logs for stage ${stageName} go to ${firehose ? "a Firehose stream" : "a destination"} faws does not read`}
        hint={<span className="font-mono break-all">{access.arn}</span>}
      />
    );
  }
  const where = access.account ? `${access.region}, account ${access.account}` : access.region;
  return (
    <EmptyState
      icon={ScrollText}
      title={`Access logs for stage ${stageName} go to ${access.name} in ${where}`}
      hint={
        access.region !== region
          ? `faws is reading ${region}; switch the region to ${access.region}, with a profile for that account, to read them.`
          : `That is not the account this profile signs in to; switch to a profile for ${access.account} to read them.`
      }
    />
  );
}

/** The lines of one log group in a window, tailed, filtered and copied as on its own page. */
function LogReader({
  group,
  windowMinutes,
  onWindow,
}: {
  group: string;
  windowMinutes: CloudWatchWindow;
  onWindow: (next: CloudWatchWindow) => void;
}) {
  const scope = useAwsScope();
  const { refreshSeconds } = useScope();
  const [showStream, toggleStream] = useShownSearch("stream");
  const [appliedFilter, setAppliedFilter] = React.useState<string | null>(null);
  const [tail, setTail] = React.useState(true);
  const [order, setOrder] = React.useState<LogOrder>("asc");

  const logs = useQuery({
    ...trpc.cloudwatch.logEvents.queryOptions({
      ...scope,
      logGroup: group,
      windowMinutes,
      ...(appliedFilter ? { filterPattern: appliedFilter } : {}),
      limit: 500,
    }),
    ...tailPolling(tail, refreshSeconds),
  });

  const events = React.useMemo(() => logs.data?.events ?? [], [logs.data]);
  const ordered = React.useMemo(
    () => (order === "asc" ? events : events.toReversed()),
    [events, order],
  );

  const bodyRef = React.useRef<HTMLDivElement>(null);
  useFollowNewest(bodyRef, ordered, tail, order);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2">
        <WindowPicker value={windowMinutes} onChange={onWindow} />
        {logs.isFetching ? <Spinner /> : null}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <LogViewControls
            tail={tail}
            onToggleTail={() => setTail((prev) => !prev)}
            showStream={showStream}
            onToggleStream={toggleStream}
            order={order}
            onToggleOrder={() => setOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
          />
          <LogFilterBar onApply={setAppliedFilter} />
          <CopyButton
            variant="ghost"
            size="icon"
            label="log lines"
            value={() =>
              events.map((event) => `${event.timestamp} ${stripAnsi(event.message)}`).join("\n")
            }
          />
        </div>
      </div>
      <LogWindowView
        logs={logs}
        lines={ordered}
        windowMinutes={windowMinutes}
        showStream={showStream}
        bodyRef={bodyRef}
      />
    </>
  );
}
