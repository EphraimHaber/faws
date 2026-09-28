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
