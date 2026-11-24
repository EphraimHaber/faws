import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it } from "vitest";

import { DomainError } from "../errors.ts";
import { setDestructiveAllowed, setReadOnly } from "../guard.ts";
import { publicProcedure, router, undeclaredMutations } from "./index.ts";

class GoneError extends DomainError {
  readonly kind = "GoneError";
  readonly status = "NOT_FOUND";
  protected override details() {
    return { what: "bucket", missing: undefined };
  }
}

const testRouter = router({
  peek: publicProcedure.query(() => "ok"),
  rename: publicProcedure.meta({ effect: "write", operation: "test:Rename" }).mutation(() => "ok"),
  shred: publicProcedure.meta({ effect: "destructive" }).mutation(() => "ok"),
  remember: publicProcedure.meta({ effect: "local" }).mutation(() => "ok"),
  forget: publicProcedure.mutation(() => "ok"),
  fail: publicProcedure.query(() => {
    throw new GoneError("That bucket is gone.");
  }),
});
const caller = testRouter.createCaller({});

afterEach(() => {
  setReadOnly(true);
});

describe("effects", () => {
  it("refuses a write while read-only, naming the operation", async () => {
    setReadOnly(true);
    await expect(caller.rename()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: 'Read-only mode is on; "test:Rename" was blocked.',
    });
  });

  it("lets a write through once read-only is off", async () => {
    setReadOnly(false);
    await expect(caller.rename()).resolves.toBe("ok");
  });

  it("holds a destructive call to the second switch, named by its path", async () => {
    setReadOnly(false);
    await expect(caller.shred()).rejects.toThrow('"shred" destroys data');
    setDestructiveAllowed(true);
    await expect(caller.shred()).resolves.toBe("ok");
  });

  it("never holds back local or read procedures", async () => {
    setReadOnly(true);
    await expect(caller.remember()).resolves.toBe("ok");
    await expect(caller.peek()).resolves.toBe("ok");
  });

  it("lists the mutations that declare no effect", () => {
    expect(undeclaredMutations(testRouter)).toEqual(["forget"]);
  });
});

describe("errors", () => {
  it("gives a thrown domain error its own status and cause", async () => {
    const error = await caller.fail().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: "NOT_FOUND", message: "That bucket is gone." });
    expect((error as TRPCError).cause).toBeInstanceOf(GoneError);
    expect(((error as TRPCError).cause as GoneError).toCause()).toEqual({
      kind: "GoneError",
      message: "That bucket is gone.",
      what: "bucket",
    });
  });
});
