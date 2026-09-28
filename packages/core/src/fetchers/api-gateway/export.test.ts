import { describe, expect, it } from "vitest";

import { restApiExport } from "./export.ts";

describe("restApiExport", () => {
  it("decodes the body as UTF-8 text", () => {
    const text = '{"openapi":"3.0.1","info":{"title":"caf\u00e9"}}';
    const body = new TextEncoder().encode(text);
    expect(restApiExport({ body }, "prod", "oas30")).toEqual({
      stageName: "prod",
      format: "oas30",
      bytes: body.byteLength,
      body: text,
    });
  });

  it("leaves out a body over the limit but reports its size", () => {
    const body = new Uint8Array(11);
    expect(restApiExport({ body }, "prod", "swagger", 10)).toEqual({
      stageName: "prod",
      format: "swagger",
      bytes: 11,
      body: null,
    });
  });

  it("reads a missing body as empty", () => {
    expect(restApiExport({}, "prod", "oas30")).toMatchObject({ bytes: 0, body: "" });
  });
});
