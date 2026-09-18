import { describe, expect, it } from "vitest";

import { reconcile } from "./echo.ts";

const me = { revision: 5, originId: "tab-1" };

describe("reconcile", () => {
  it("applies a newer change from another window", () => {
    expect(reconcile({ revision: 6, originId: "tab-2" }, me)).toEqual({ apply: true, revision: 6 });
  });

  it("applies a change no window caused, such as a failed write", () => {
    expect(reconcile({ revision: 6, originId: null }, me)).toEqual({ apply: true, revision: 6 });
  });

  it("drops our own echo but still advances the watermark", () => {
    expect(reconcile({ revision: 9, originId: "tab-1" }, me)).toEqual({
      apply: false,
      revision: 9,
    });
  });

  it("drops a response that arrived after a later one", () => {
    expect(reconcile({ revision: 4, originId: "tab-2" }, me)).toEqual({
      apply: false,
      revision: 5,
    });
  });

  it("drops a repeat of the revision already applied", () => {
    expect(reconcile({ revision: 5, originId: "tab-2" }, me)).toEqual({
      apply: false,
      revision: 5,
    });
  });
});
