/**
 * Flattened ECS view models.
 *
 * The AWS SDK shapes are deeply optional and carry far more than the UI
 * reads. These types are the contract between server fetchers and the
 * renderer: everything the tables and detail panes bind to, with the
 * optionality already resolved.
 */

export type ClusterStatus = "ACTIVE" | "PROVISIONING" | "DEPROVISIONING" | "FAILED" | "INACTIVE";

export interface EcsCluster {
  readonly name: string;
  readonly arn: string;
  readonly status: ClusterStatus | string;
  readonly runningTasks: number;
  readonly pendingTasks: number;
  readonly activeServices: number;
  readonly registeredInstances: number;
  readonly capacityProviders: ReadonlyArray<string>;
  readonly containerInsights: boolean;
  readonly tags: Readonly<Record<string, string>>;
}

export type ServiceDeploymentState = "steady" | "deploying" | "degraded" | "draining" | "unknown";

/**
 * The deployment circuit breaker, as configured on the service.
 *
 * When `rollback` is on, ECS reverts to the previous task definition after
 * enough task failures — so during a bad rollout the question isn't only "is
 * it failing" but "is it about to undo itself".
 */
export interface DeploymentCircuitBreaker {
  readonly enabled: boolean;
  readonly rollback: boolean;
}

export interface EcsService {
  readonly name: string;
  readonly arn: string;
  readonly clusterName: string;
  readonly status: string;
  readonly launchType: string | null;
  readonly schedulingStrategy: string | null;
  readonly desiredCount: number;
  readonly runningCount: number;
  readonly pendingCount: number;
  readonly taskDefinition: string;
  readonly taskDefinitionFamily: string;
  readonly taskDefinitionRevision: number;
  readonly platformVersion: string | null;
  readonly deploymentState: ServiceDeploymentState;
  readonly activeDeployments: number;
  readonly createdAt: string | null;
  /**
   * Rollout facts lifted off the PRIMARY deployment so the services *list* can
   * answer "when did this last change and did it go well?" without a
   * per-service describe call.
   */
  readonly lastDeploymentAt: string | null;
  readonly lastDeploymentUpdatedAt: string | null;
  readonly rolloutState: string | null;
  readonly rolloutStateReason: string | null;
  readonly failedTasks: number;
  /**
   * When the current rollout finished and nothing has changed since — the
   * closest thing ECS gives to "how long has this been up".
   */
  readonly steadySince: string | null;
  readonly loadBalancers: ReadonlyArray<{
    readonly targetGroupArn: string | null;
    readonly containerName: string | null;
    readonly containerPort: number | null;
  }>;
  readonly enableExecuteCommand: boolean;
  readonly circuitBreaker: DeploymentCircuitBreaker | null;
  /** Bounds ECS keeps during a rollout, as percentages of desired count. */
  readonly minimumHealthyPercent: number | null;
  readonly maximumPercent: number | null;
  readonly tags: Readonly<Record<string, string>>;
}

export interface EcsServiceEvent {
  readonly id: string;
  readonly createdAt: string | null;
  readonly message: string;
}

export interface EcsDeployment {
  readonly id: string;
  readonly status: string;
  readonly taskDefinition: string;
  readonly desiredCount: number;
  readonly runningCount: number;
  readonly pendingCount: number;
  readonly failedTasks: number;
  readonly rolloutState: string | null;
  readonly rolloutStateReason: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface EcsServiceDetail {
  readonly service: EcsService;
  readonly deployments: ReadonlyArray<EcsDeployment>;
  readonly events: ReadonlyArray<EcsServiceEvent>;
}

export type TaskHealth = "HEALTHY" | "UNHEALTHY" | "UNKNOWN" | string;

export interface EcsContainer {
  readonly name: string;
  readonly arn: string;
  readonly runtimeId: string | null;
  readonly image: string | null;
  readonly imageDigest: string | null;
  readonly lastStatus: string;
  readonly health: TaskHealth;
  readonly exitCode: number | null;
  readonly reason: string | null;
  readonly cpu: string | null;
  readonly memory: string | null;
  readonly networkInterfaces: ReadonlyArray<{
    readonly privateIpv4Address: string | null;
    readonly attachmentId: string | null;
  }>;
}

export interface EcsTask {
  readonly id: string;
  readonly arn: string;
  readonly clusterName: string;
  readonly serviceName: string | null;
  readonly group: string | null;
  readonly lastStatus: string;
  readonly desiredStatus: string;
  readonly health: TaskHealth;
  readonly launchType: string | null;
  readonly capacityProvider: string | null;
  readonly cpu: string | null;
  readonly memory: string | null;
  readonly taskDefinition: string;
  readonly containerInstanceArn: string | null;
  readonly availabilityZone: string | null;
  readonly startedAt: string | null;
  readonly stoppedAt: string | null;
  readonly stoppedReason: string | null;
  readonly enableExecuteCommand: boolean;
  readonly privateIp: string | null;
  readonly containers: ReadonlyArray<EcsContainer>;
}

export interface EcsContainerInstance {
  readonly id: string;
  readonly arn: string;
  readonly ec2InstanceId: string | null;
  readonly status: string;
  readonly agentConnected: boolean;
  readonly agentVersion: string | null;
  readonly runningTasks: number;
  readonly pendingTasks: number;
  readonly registeredCpu: number | null;
  readonly remainingCpu: number | null;
  readonly registeredMemory: number | null;
  readonly remainingMemory: number | null;
  readonly capacityProvider: string | null;
}

export interface EcsTaskDefinitionSummary {
  readonly family: string;
  readonly revision: number;
  readonly arn: string;
  readonly status: string;
  readonly cpu: string | null;
  readonly memory: string | null;
  readonly networkMode: string | null;
  readonly requiresCompatibilities: ReadonlyArray<string>;
  readonly registeredAt: string | null;
  readonly containerNames: ReadonlyArray<string>;
}

/**
 * A task definition exactly as ECS returned it, for the JSON pane.
 *
 * Deliberately not the SDK's `TaskDefinition`: the renderer only reads and
 * prints this document, and typing it as the SDK shape would drag
 * `@aws-sdk/client-ecs` into the client's type graph for no gain.
 */
export type EcsTaskDefinitionDocument = Readonly<Record<string, unknown>>;

/**
 * One registered target behind a load balancer.
 *
 * During a rollout this is the difference between "ECS started the task" and
 * "traffic is actually reaching it" — the gap where a deployment looks fine
 * but the new version is failing its health check.
 */
export interface TargetHealth {
  readonly targetId: string;
  readonly port: number | null;
  readonly availabilityZone: string | null;
  /** initial | healthy | unhealthy | unused | draining | unavailable */
  readonly state: string;
  readonly reason: string | null;
  readonly description: string | null;
}

export interface TargetGroupHealth {
  readonly targetGroupArn: string;
  readonly targetGroupName: string;
  readonly containerName: string | null;
  readonly containerPort: number | null;
  readonly protocol: string | null;
  readonly healthCheckPath: string | null;
  readonly healthCheckIntervalSeconds: number | null;
  readonly healthyThresholdCount: number | null;
  readonly unhealthyThresholdCount: number | null;
  readonly targets: ReadonlyArray<TargetHealth>;
}

/** A single CloudWatch datapoint for the service metric charts. */
export interface MetricPoint {
  readonly timestamp: string;
  readonly average: number | null;
  readonly maximum: number | null;
}

export interface MetricSeries {
  readonly metric: "CPUUtilization" | "MemoryUtilization";
  readonly points: ReadonlyArray<MetricPoint>;
}

/**
 * Where one container's logs live, resolved from its task definition.
 *
 * `null` group means the container uses a log driver other than `awslogs`
 * (awsfirelens, splunk, none), which is what the UI uses to explain why a
 * Logs tab is empty instead of showing a blank pane.
 */
export interface ContainerLogConfig {
  readonly containerName: string;
  readonly logDriver: string | null;
  readonly logGroup: string | null;
  readonly streamPrefix: string | null;
  readonly region: string | null;
}

/** One rendered CloudWatch Logs line for the log pane. */
export interface LogEvent {
  readonly timestamp: string;
  readonly message: string;
  readonly stream: string;
}

/**
 * A deployment as the ListServiceDeployments API reports it.
 *
 * `DescribeServices` only ever returns the deployments that are currently
 * active, so this is the only way to see what happened last Tuesday. It also
 * carries detail the live view has to infer — the real circuit-breaker
 * threshold, the alarm monitors, and why a rollback started.
 */
export interface ServiceRevisionCounts {
  readonly arn: string;
  /** Task definition family:revision, resolved from the revision ARN. */
  readonly taskDefinition: string | null;
  readonly requestedCount: number | null;
  readonly runningCount: number | null;
  readonly pendingCount: number | null;
}

export type ServiceDeploymentStatusValue =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUCCESSFUL"
  | "STOPPED"
  | "STOP_REQUESTED"
  | "ROLLBACK_REQUESTED"
  | "ROLLBACK_IN_PROGRESS"
  | "ROLLBACK_SUCCESSFUL"
  | "ROLLBACK_FAILED"
  | string;

export interface ServiceDeploymentCircuitBreakerState {
  readonly status: string | null;
  readonly failureCount: number | null;
  /** AWS's own threshold, rather than the documented formula. */
  readonly threshold: number | null;
}

export interface ServiceDeploymentAlarmState {
  readonly status: string | null;
  readonly alarmNames: ReadonlyArray<string>;
  readonly triggeredAlarmNames: ReadonlyArray<string>;
}

export interface ServiceDeploymentRollback {
  readonly reason: string | null;
  readonly startedAt: string | null;
  readonly serviceRevisionArn: string | null;
  readonly taskDefinition: string | null;
}

export interface ServiceDeploymentRecord {
  readonly arn: string;
  /** Trailing id, which is what the console and the events call it. */
  readonly id: string;
  readonly status: ServiceDeploymentStatusValue;
  readonly statusReason: string | null;
  readonly lifecycleStage: string | null;
  readonly createdAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly stoppedAt: string | null;
  readonly updatedAt: string | null;
  /** Wall-clock length, or time so far when still running. */
  readonly durationSeconds: number | null;
  readonly source: ReadonlyArray<ServiceRevisionCounts>;
  readonly target: ServiceRevisionCounts | null;
  readonly circuitBreaker: ServiceDeploymentCircuitBreakerState | null;
  readonly alarms: ServiceDeploymentAlarmState | null;
  readonly rollback: ServiceDeploymentRollback | null;
}
