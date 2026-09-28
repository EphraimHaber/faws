import { type ExportResponse, GetExportCommand } from "@aws-sdk/client-api-gateway";
import type { AwsScope, RestApiExport, RestApiExportFormat } from "@faws/contracts";

import { apiGatewayClient, callAws } from "../../clients.ts";

/**
 * The largest definition passed on to the page. A few thousand operations fit
 * well under it; past it the JSON viewer and the tRPC response both struggle.
 */
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;

/** An export's body decoded to text, or left out when it is over `maxBytes`. */
export function restApiExport(
  output: Pick<ExportResponse, "body">,
  stageName: string,
  format: RestApiExportFormat,
  maxBytes: number = MAX_EXPORT_BYTES,
): RestApiExport {
  const body = output.body ?? new Uint8Array();
  return {
    stageName,
    format,
    bytes: body.byteLength,
    body: body.byteLength > maxBytes ? null : new TextDecoder().decode(body),
  };
}

/** One stage's API definition as OpenAPI 3.0 or Swagger 2.0 JSON. */
export async function exportApi(
  scope: AwsScope,
  apiId: string,
  stageName: string,
  format: RestApiExportFormat,
): Promise<RestApiExport> {
  const client = apiGatewayClient(scope);
  const output = await callAws("apigateway", () =>
    client.send(
      new GetExportCommand({
        restApiId: apiId,
        stageName,
        exportType: format,
        accepts: "application/json",
      }),
    ),
  );
  return restApiExport(output, stageName, format);
}
