/** One REST API, as GetRestApis lists it. */
export interface RestApiSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string | null;
  readonly version: string | null;
  /** EDGE, REGIONAL or PRIVATE; AWS allows more than one. */
  readonly endpointTypes: ReadonlyArray<string>;
  /** HEADER or AUTHORIZER: where a request's API key is read from. */
  readonly apiKeySource: string | null;
}

/** The REST APIs a listing reached; `truncated` when the region has more. */
export interface RestApiListing {
  readonly apis: ReadonlyArray<RestApiSummary>;
  readonly truncated: boolean;
}

/** One REST API with everything GetRestApi says about it. */
export interface RestApiDetail extends RestApiSummary {
  /** The VPC endpoints a PRIVATE API is reached through. */
  readonly vpcEndpointIds: ReadonlyArray<string>;
  readonly binaryMediaTypes: ReadonlyArray<string>;
  /** In bytes; `null` when compression is off. */
  readonly minimumCompressionSize: number | null;
  /** True when callers must come in through a custom domain. */
  readonly disableExecuteApiEndpoint: boolean;
  readonly tags: Readonly<Record<string, string>>;
  /** The resource policy as JSON text, or `null` when none is set. */
  readonly policy: string | null;
}

/** What a method hands a request to once it is accepted. */
export interface RestApiIntegration {
  /** AWS, AWS_PROXY, HTTP, HTTP_PROXY or MOCK. */
  readonly type: string | null;
  /** The method used to call the backend, which need not be the client's. */
  readonly httpMethod: string | null;
  readonly uri: string | null;
  /** INTERNET or VPC_LINK. */
  readonly connectionType: string | null;
  /** The VPC link id when the connection is VPC_LINK. */
  readonly connectionId: string | null;
  /** The role API Gateway assumes to call the backend. */
  readonly credentials: string | null;
  readonly timeoutMs: number | null;
  readonly passthroughBehavior: string | null;
  readonly cacheKeyParameters: ReadonlyArray<string>;
}

/** One HTTP method on a resource. */
export interface RestApiMethod {
  readonly httpMethod: string;
  /** NONE, AWS_IAM, CUSTOM or COGNITO_USER_POOLS. */
  readonly authorizationType: string | null;
  readonly authorizerId: string | null;
  readonly apiKeyRequired: boolean;
  readonly operationName: string | null;
  /** Each parameter's name, e.g. `method.request.querystring.page`, to whether it is required. */
  readonly requestParameters: Readonly<Record<string, boolean>>;
  readonly integration: RestApiIntegration | null;
}

/** One path in a REST API, as GetResources lists it. */
export interface RestApiResource {
  readonly id: string;
  /** `null` for the root resource, `/`. */
  readonly parentId: string | null;
  readonly path: string;
  readonly pathPart: string | null;
  readonly methods: ReadonlyArray<RestApiMethod>;
}

/** The resources a listing reached; `truncated` when the API has more. */
export interface RestApiResourceListing {
  readonly resources: ReadonlyArray<RestApiResource>;
  readonly truncated: boolean;
}

/** How requests to some or all of a stage's methods are logged, throttled and cached. */
export interface RestApiMethodSetting {
  /** `*` when the setting covers every path; otherwise a resource path such as `/orders`. */
  readonly resourcePath: string;
  /** `*` when the setting covers every method. */
  readonly httpMethod: string;
  /** OFF, ERROR or INFO: what goes to the stage's execution log group. */
  readonly loggingLevel: string | null;
  /** Whether full requests and responses are written to the execution log. */
  readonly dataTraceEnabled: boolean;
  /** Whether per method metrics are sent to CloudWatch. */
  readonly metricsEnabled: boolean;
  readonly throttlingBurstLimit: number | null;
  /** Requests a second. */
  readonly throttlingRateLimit: number | null;
  readonly cachingEnabled: boolean;
  readonly cacheTtlSeconds: number | null;
  readonly cacheDataEncrypted: boolean;
}

/** A canary: a share of a stage's traffic sent to another deployment. */
export interface RestApiCanary {
  /** 0 to 100. */
  readonly percentTraffic: number | null;
  readonly deploymentId: string | null;
  readonly stageVariableOverrides: Readonly<Record<string, string>>;
  readonly useStageCache: boolean;
}

/** One stage of a REST API, as GetStages lists it. */
export interface RestApiStage {
  readonly name: string;
  readonly deploymentId: string | null;
  readonly description: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly variables: Readonly<Record<string, string>>;
  readonly cacheClusterEnabled: boolean;
  /** In GB, e.g. `0.5`, as text because AWS names the sizes that way. */
  readonly cacheClusterSize: string | null;
  readonly cacheClusterStatus: string | null;
  /** Whether requests are traced with X-Ray. */
  readonly tracingEnabled: boolean;
  readonly webAclArn: string | null;
  readonly clientCertificateId: string | null;
  readonly documentationVersion: string | null;
  /** Where access logs go, a log group or Firehose stream ARN, and their format. */
  readonly accessLog: { readonly destinationArn: string; readonly format: string | null } | null;
  readonly canary: RestApiCanary | null;
  /** The stage wide `*` setting first, then per method overrides by path. */
  readonly methodSettings: ReadonlyArray<RestApiMethodSetting>;
  readonly tags: Readonly<Record<string, string>>;
}

/** One deployment: a snapshot of the API that stages serve. */
export interface RestApiDeployment {
  readonly id: string;
  readonly description: string | null;
  readonly createdAt: string | null;
}

/** The deployments a listing reached, newest first; `truncated` when the API has more. */
export interface RestApiDeploymentListing {
  readonly deployments: ReadonlyArray<RestApiDeployment>;
  readonly truncated: boolean;
}

/** What checks a caller before a method runs: a Lambda function or a Cognito user pool. */
export interface RestApiAuthorizer {
  readonly id: string;
  readonly name: string;
  /** TOKEN, REQUEST or COGNITO_USER_POOLS. */
  readonly type: string | null;
  /** Where the caller's identity is read from, e.g. `method.request.header.Authorization`. */
  readonly identitySource: string | null;
  /** A pattern a TOKEN authorizer's token must match before the authorizer is called. */
  readonly identityValidationExpression: string | null;
  /** The Lambda invocation URI of a TOKEN or REQUEST authorizer. */
  readonly authorizerUri: string | null;
  /** The role API Gateway assumes to call the authorizer. */
  readonly credentials: string | null;
  /** How long a decision is cached; 0 turns caching off. */
  readonly resultTtlSeconds: number | null;
  /** The user pools a COGNITO_USER_POOLS authorizer accepts tokens from. */
  readonly providerArns: ReadonlyArray<string>;
}

/** The authorizers a listing reached, by name; `truncated` when the API has more. */
export interface RestApiAuthorizerListing {
  readonly authorizers: ReadonlyArray<RestApiAuthorizer>;
  readonly truncated: boolean;
}

/** The definition formats GetExport writes: OpenAPI 3.0 or Swagger 2.0. */
export const REST_API_EXPORT_FORMATS = ["oas30", "swagger"] as const;
export type RestApiExportFormat = (typeof REST_API_EXPORT_FORMATS)[number];

/** A stage's API definition, as GetExport writes it. */
export interface RestApiExport {
  readonly stageName: string;
  readonly format: RestApiExportFormat;
  /** The size of the definition as AWS sent it. */
  readonly bytes: number;
  /** The definition as JSON text, or `null` when it is too large to send on. */
  readonly body: string | null;
}

/** A custom domain name that callers reach APIs through, as GetDomainNames lists it. */
export interface CustomDomain {
  readonly name: string;
  /** Set only on a private custom domain, which is known by its name and this id together. */
  readonly domainNameId: string | null;
  readonly arn: string | null;
  /** EDGE, REGIONAL or PRIVATE. */
  readonly endpointTypes: ReadonlyArray<string>;
  /** What the domain's DNS record points at for a regional endpoint. */
  readonly regionalDomainName: string | null;
  readonly regionalHostedZoneId: string | null;
  /** The CloudFront distribution the DNS record points at for an edge optimized endpoint. */
  readonly distributionDomainName: string | null;
  readonly distributionHostedZoneId: string | null;
  /** The ACM certificate served: the regional one, or the edge or private one when there is none. */
  readonly certificateArn: string | null;
  readonly certificateName: string | null;
  readonly certificateUploadedAt: string | null;
  /** The TLS version and cipher suite, e.g. `TLS_1_2`. */
  readonly securityPolicy: string | null;
  /** AVAILABLE, UPDATING, PENDING, FAILED or one of the PENDING_ reasons. */
  readonly status: string | null;
  readonly statusMessage: string | null;
  /** How requests are routed: by base path mapping, by routing rule, or both. */
  readonly routingMode: string | null;
  /** The S3 URI of the truststore when callers must present a client certificate. */
  readonly mutualTlsTruststoreUri: string | null;
  readonly ownershipVerificationCertificateArn: string | null;
  readonly tags: Readonly<Record<string, string>>;
}

/** The custom domains a listing reached, by name; `truncated` when the region has more. */
export interface CustomDomainListing {
  readonly domains: ReadonlyArray<CustomDomain>;
  readonly truncated: boolean;
}

/** Which API and stage one path under a custom domain goes to. */
export interface BasePathMapping {
  /** The first path segment callers add after the domain; empty for the domain's root. */
  readonly basePath: string;
  /**
   * The API it points at. Usually a REST API, but it can be an HTTP or
   * WebSocket API mapped to the same domain, or an API since deleted.
   */
  readonly restApiId: string | null;
  /** `null` when the caller names the stage in the path after the base path. */
  readonly stage: string | null;
}

/** The mappings a listing reached, by base path; `truncated` when the domain has more. */
export interface BasePathMappingListing {
  readonly mappings: ReadonlyArray<BasePathMapping>;
  readonly truncated: boolean;
}

/** A steady request rate and the burst allowed above it; either may be unset. */
export interface ThrottleLimits {
  /** Requests a second. */
  readonly rateLimit: number | null;
  readonly burstLimit: number | null;
}

/** How many requests a key may make in each period. */
export interface UsagePlanQuota {
  readonly limit: number | null;
  /** DAY, WEEK or MONTH. */
  readonly period: string | null;
  /** Requests taken off the limit in the first period only. */
  readonly offset: number | null;
}

/** A per-method throttle a usage plan sets on one of its stages. */
export interface UsagePlanMethodThrottle {
  readonly resourcePath: string;
  readonly httpMethod: string;
  readonly throttle: ThrottleLimits;
}

/** One stage of one API that a usage plan meters. */
export interface UsagePlanApiStage {
  readonly apiId: string;
  readonly stage: string;
  /** Sorted by path, then method. */
  readonly methodThrottles: ReadonlyArray<UsagePlanMethodThrottle>;
}

/** A usage plan, as GetUsagePlans lists it. */
export interface UsagePlan {
  readonly id: string;
  /** Falls back to the id when the plan has no name. */
  readonly name: string;
  readonly description: string | null;
  /** `null` when the plan sets no throttle, so the stage's own limits apply. */
  readonly throttle: ThrottleLimits | null;
  /** `null` when the plan sets no quota. */
  readonly quota: UsagePlanQuota | null;
  readonly apiStages: ReadonlyArray<UsagePlanApiStage>;
  /** The AWS Marketplace product the plan is sold as, if any. */
  readonly productCode: string | null;
  readonly tags: Readonly<Record<string, string>>;
}

/** The usage plans a listing reached, by name; `truncated` when the region has more. */
export interface UsagePlanListing {
  readonly plans: ReadonlyArray<UsagePlan>;
  readonly truncated: boolean;
}

/** One key on a usage plan. The key's value is never read. */
export interface UsagePlanKey {
  /** The API key's id. */
  readonly id: string;
  readonly name: string | null;
  /** Always API_KEY today. */
  readonly type: string | null;
}

/** The keys a listing reached on one plan, by name; `truncated` when the plan has more. */
export interface UsagePlanKeyListing {
  readonly keys: ReadonlyArray<UsagePlanKey>;
  readonly truncated: boolean;
}

/** An API key, as GetApiKeys lists it without values. */
export interface ApiKey {
  readonly id: string;
  /** Falls back to the id when the key has no name. */
  readonly name: string;
  readonly description: string | null;
  /** The AWS Marketplace customer the key was issued to, if any. */
  readonly customerId: string | null;
  readonly enabled: boolean;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  /** The stages the key is tied to directly, outside any usage plan. */
  readonly stageKeys: ReadonlyArray<{ readonly apiId: string; readonly stage: string }>;
  readonly tags: Readonly<Record<string, string>>;
}

/** The API keys a listing reached, by name; `truncated` when the region has more. */
export interface ApiKeyListing {
  readonly keys: ReadonlyArray<ApiKey>;
  readonly truncated: boolean;
}

/** API Gateway's settings for the whole account in one region. */
export interface ApiGatewayAccount {
  /**
   * The IAM role API Gateway assumes to write logs to CloudWatch, or `null`
   * when none is set, in which case no stage in the region can write any.
   */
  readonly cloudwatchRoleArn: string | null;
}
