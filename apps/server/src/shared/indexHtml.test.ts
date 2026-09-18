import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { DEFAULT_SETTINGS } from "@faws/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createIndexHtmlRenderer } from "./indexHtml.ts";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "faws-index-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(html: string): void {
  fs.writeFileSync(path.join(root, "index.html"), html);
}

describe("createIndexHtmlRenderer", () => {
  it("replaces the marker with the current settings", async () => {
    write("<html><head><!--faws:settings--></head><body></body></html>");
    const html = await createIndexHtmlRenderer(root)({
      ...DEFAULT_SETTINGS,
      appearance: { theme: "light" },
    });

    expect(html).toContain("window.fawsSettings=");
    expect(html).toContain('"theme":"light"');
    expect(html).not.toContain("<!--faws:settings-->");
  });

  it("falls back to the end of head when the marker is absent", async () => {
    write("<html><head><title>x</title></head><body></body></html>");
    const html = await createIndexHtmlRenderer(root)(DEFAULT_SETTINGS);
    expect(html.indexOf("window.fawsSettings")).toBeLessThan(html.indexOf("</head>"));
  });

  it("cannot be closed early by a value containing a script tag", async () => {
    write("<html><head><!--faws:settings--></head><body></body></html>");
    const html = await createIndexHtmlRenderer(root)({
      ...DEFAULT_SETTINGS,
      scope: { ...DEFAULT_SETTINGS.scope, profile: "</script><script>alert(1)</script>" },
    });

    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script\\u003e");
    // One opening tag for the payload, and the bootstrap lives inside it.
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it("reflects a later change without re-reading the shell", async () => {
    write("<html><head><!--faws:settings--></head><body></body></html>");
    const render = createIndexHtmlRenderer(root);
    await render(DEFAULT_SETTINGS);
    fs.rmSync(path.join(root, "index.html"));

    const html = await render({ ...DEFAULT_SETTINGS, appearance: { theme: "light" } });
    expect(html).toContain('"theme":"light"');
  });
});
