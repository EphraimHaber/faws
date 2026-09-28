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
