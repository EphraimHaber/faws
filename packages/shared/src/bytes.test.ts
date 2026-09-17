import { describe, expect, it } from "vitest";

import { byteSize } from "./bytes.ts";

describe("byteSize", () => {
  it("leaves small counts exact", () => {
    expect(byteSize(0)).toBe("0 B");
    expect(byteSize(1023)).toBe("1023 B");
  });

  it("climbs binary units", () => {
    expect(byteSize(1024)).toBe("1.0 KiB");
    expect(byteSize(1024 ** 2)).toBe("1.0 MiB");
    expect(byteSize(1024 ** 3)).toBe("1.0 GiB");
    expect(byteSize(1024 ** 4)).toBe("1.0 TiB");
  });

  it("drops the decimal once three digits are on the left", () => {
    expect(byteSize(99.9 * 1024)).toBe("99.9 KiB");
    expect(byteSize(512 * 1024)).toBe("512 KiB");
  });

  it("stops at the largest unit it knows", () => {
    expect(byteSize(2048 * 1024 ** 5)).toBe("2048 PiB");
  });

  it("refuses a nonsensical count rather than inventing one", () => {
    expect(byteSize(-1)).toBe("-");
    expect(byteSize(Number.NaN)).toBe("-");
  });
});
