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
