import { describe, expect, it } from "vitest";

import { collectPagesUpTo } from "./clients.ts";

/** A listing of `pages` pages of two items each, recording the tokens it was asked with. */
function listing(pages: number) {
  const asked: Array<string | undefined> = [];
  const page = async (token: string | undefined) => {
    asked.push(token);
    const index = token ? Number(token) : 0;
    const next = index + 1 < pages ? String(index + 1) : undefined;
    return {
      items: [`${index}a`, `${index}b`],
      ...(next ? { nextToken: next } : {}),
    };
  };
  return { asked, page };
}

describe("collectPagesUpTo", () => {
  it("collects every page when the listing ends under the cap", async () => {
    const { asked, page } = listing(3);
    expect(await collectPagesUpTo(5, page)).toEqual({
      items: ["0a", "0b", "1a", "1b", "2a", "2b"],
      truncated: false,
    });
    expect(asked).toEqual([undefined, "1", "2"]);
  });

  it("stops at the cap and says so", async () => {
    const { asked, page } = listing(4);
    expect(await collectPagesUpTo(2, page)).toEqual({
      items: ["0a", "0b", "1a", "1b"],
      truncated: true,
    });
    expect(asked).toEqual([undefined, "1"]);
  });

  it("is not truncated when the last page falls exactly on the cap", async () => {
    const { page } = listing(2);
    expect((await collectPagesUpTo(2, page)).truncated).toBe(false);
  });
});
