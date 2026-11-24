/**
 * The behaviour every object storage port owes the bucket browser.
 *
 * A provider runs `describeObjectStoragePort` from its own tests, handing it a
 * port whose backend holds `OBJECT_STORAGE_FIXTURE`. The suite turns the write
 * switches on around each test and puts them back afterwards, and it makes a
 * fresh port for every test, so a write in one is never seen by the next.
 */
import type { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ConnectionRef } from "../connection.ts";
import { ReadOnlyModeError } from "../errors.ts";
import { setDestructiveAllowed, setReadOnly } from "../guard.ts";
import type { ObjectStoragePort } from "../server/objectStorage.ts";

export interface ObjectStorageFixtureObject {
  readonly key: string;
  readonly body: string;
  readonly contentType: string;
}

export interface ObjectStorageFixture {
  /** Holds every fixture object. */
  readonly bucket: string;
  /** Empty, as a destination for copies. */
  readonly otherBucket: string;
  readonly objects: ReadonlyArray<ObjectStorageFixtureObject>;
}

export const OBJECT_STORAGE_FIXTURE: ObjectStorageFixture = {
  bucket: "fixture-data",
  otherBucket: "fixture-archive",
  objects: [
    { key: "readme.txt", body: "hello, storage", contentType: "text/plain" },
    { key: "logs/2026/01.json", body: '{"n":1}', contentType: "application/json" },
    { key: "logs/2026/02.json", body: '{"n":2}', contentType: "application/json" },
    { key: "logs/latest.log", body: "one\ntwo\n", contentType: "text/plain" },
  ],
};

export interface ObjectStorageHarness {
  readonly port: ObjectStoragePort;
  readonly ref: ConnectionRef;
}

export type MakeObjectStoragePort = (
  fixture: ObjectStorageFixture,
) => ObjectStorageHarness | Promise<ObjectStorageHarness>;

async function readAll(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function fixtureObject(key: string): ObjectStorageFixtureObject {
  const found = OBJECT_STORAGE_FIXTURE.objects.find((object) => object.key === key);
  if (!found) throw new Error(`No fixture object ${key}`);
  return found;
}

export function describeObjectStoragePort(name: string, makePort: MakeObjectStoragePort): void {
  describe(`object storage port: ${name}`, () => {
    const fixture = OBJECT_STORAGE_FIXTURE;
    const { bucket, otherBucket } = fixture;
    let port: ObjectStoragePort;
    let ref: ConnectionRef;

    beforeEach(async () => {
      ({ port, ref } = await makePort(fixture));
      setReadOnly(false);
      setDestructiveAllowed(true);
    });

    afterEach(() => {
      setReadOnly(true);
    });

    const read = async (target: string, key: string) =>
      readAll((await port.openRead(ref, { bucket: target, key })).body);

    it("says what it can do", async () => {
      const features = await port.features(ref);
      expect(typeof features.bucketRegions).toBe("boolean");
      expect(typeof features.storageMetrics).toBe("boolean");
      expect(typeof features.presign).toBe("boolean");
    });

    it("lists every bucket, by name", async () => {
      const names = (await port.listBuckets(ref)).map((entry) => entry.name);
      expect(names).toEqual([otherBucket, bucket].toSorted());
    });

    it("answers with a region for a bucket", async () => {
      await expect(port.bucketRegion(ref, bucket)).resolves.toMatch(/\S/);
    });

    it("lists one level of a prefix as folders and objects", async () => {
      const page = await port.listObjects(ref, {
        bucket,
        prefix: "",
        delimiter: "/",
        maxKeys: 100,
      });
      expect(page.prefixes.map((entry) => entry.prefix)).toEqual(["logs/"]);
      expect(page.objects.map((entry) => entry.key)).toEqual(["readme.txt"]);
      expect(page.objects[0]?.size).toBe(fixtureObject("readme.txt").body.length);
      expect(page.nextToken).toBeNull();
    });

    it("pages with the cursor it hands back", async () => {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await port.listObjects(ref, { bucket, prefix: "logs/", maxKeys: 1, cursor });
        expect(page.objects.length).toBeLessThanOrEqual(1);
        keys.push(...page.objects.map((entry) => entry.key));
        cursor = page.nextToken ?? undefined;
      } while (cursor);
      expect(keys).toEqual(["logs/2026/01.json", "logs/2026/02.json", "logs/latest.log"]);
    });

    it("describes an object, and answers null for a missing one", async () => {
      const head = await port.head(ref, { bucket, key: "logs/2026/01.json" });
      expect(head).toMatchObject({
        bucket,
        key: "logs/2026/01.json",
        size: fixtureObject("logs/2026/01.json").body.length,
        contentType: "application/json",
        openAs: "json",
        readable: true,
      });
      await expect(port.head(ref, { bucket, key: "nope.txt" })).resolves.toBeNull();
    });

    it("streams an object whole or a range of it", async () => {
      await expect(read(bucket, "readme.txt")).resolves.toBe("hello, storage");
      const slice = await port.openRead(ref, { bucket, key: "readme.txt" }, { range: "bytes=0-4" });
      await expect(readAll(slice.body)).resolves.toBe("hello");
      expect(slice.contentRange).toBe(`bytes 0-4/${"hello, storage".length}`);
    });

    it("lists versions newest first per key", async () => {
      const page = await port.listVersions(ref, { bucket, prefix: "logs/2026/" });
      expect(page.versions.map((entry) => entry.key)).toEqual([
        "logs/2026/01.json",
        "logs/2026/02.json",
      ]);
      expect(page.versions.every((entry) => !entry.isDeleteMarker)).toBe(true);
    });

    it("reads a bucket's configuration without failing on what is not set", async () => {
      const config = await port.bucketConfig(ref, bucket);
      expect(["Enabled", "Suspended", "Disabled"]).toContain(config.versioning);
      await expect(port.bucketVersioning(ref, bucket)).resolves.toBeTypeOf("boolean");
    });

    it("writes a new object, and refuses to replace one unless told to", async () => {
      const body = new TextEncoder().encode("fresh");
      await port.putObject(ref, {
        bucket,
        key: "new.txt",
        body,
        contentLength: body.length,
        contentType: "text/plain",
        overwrite: false,
      });
      await expect(read(bucket, "new.txt")).resolves.toBe("fresh");

      const again = new TextEncoder().encode("again");
      const replace = (overwrite: boolean) =>
        port.putObject(ref, {
          bucket,
          key: "new.txt",
          body: again,
          contentLength: again.length,
          overwrite,
        });
      await expect(replace(false)).rejects.toThrow();
      await replace(true);
      await expect(read(bucket, "new.txt")).resolves.toBe("again");
    });

    it("assembles a multipart upload from its parts in part order", async () => {
      const uploadId = await port.createUpload(ref, { bucket, key: "big.bin" });
      const part = (partNumber: number, text: string) => {
        const body = new TextEncoder().encode(text);
        return port.uploadPart(ref, {
          bucket,
          key: "big.bin",
          uploadId,
          partNumber,
          body,
          contentLength: body.length,
        });
      };
      const second = await part(2, "-world");
      const first = await part(1, "hello");
      await port.completeUpload(ref, {
        bucket,
        key: "big.bin",
        uploadId,
        parts: [
          { partNumber: 2, etag: second },
          { partNumber: 1, etag: first },
        ],
        overwrite: false,
      });
      await expect(read(bucket, "big.bin")).resolves.toBe("hello-world");
    });

    it("abandons an upload without leaving an object behind", async () => {
      const uploadId = await port.createUpload(ref, { bucket, key: "dropped.bin" });
      await port.abortUpload(ref, { bucket, key: "dropped.bin", uploadId });
      await expect(port.head(ref, { bucket, key: "dropped.bin" })).resolves.toBeNull();
    });

    it("deletes objects and reports each one", async () => {
      const outcome = await port.deleteObjects(ref, { bucket, objects: [{ key: "readme.txt" }] });
      expect(outcome.deleted.map((entry) => entry.key)).toEqual(["readme.txt"]);
      expect(outcome.errors).toEqual([]);
      await expect(port.head(ref, { bucket, key: "readme.txt" })).resolves.toBeNull();
    });

    it("copies across buckets, and a move removes the source", async () => {
      const copy = {
        sourceBucket: bucket,
        sourceKey: "readme.txt",
        destBucket: otherBucket,
        destKey: "copied.txt",
        deleteSource: false,
        overwrite: false,
      };
      await port.copyObject(ref, copy);
      await expect(read(otherBucket, "copied.txt")).resolves.toBe("hello, storage");
      await expect(port.head(ref, { bucket, key: "readme.txt" })).resolves.not.toBeNull();

      await port.copyObject(ref, { ...copy, destKey: "moved.txt", deleteSource: true });
      await expect(read(otherBucket, "moved.txt")).resolves.toBe("hello, storage");
      await expect(port.head(ref, { bucket, key: "readme.txt" })).resolves.toBeNull();
    });

    it("creates a folder that the listing then shows", async () => {
      await port.createPrefix(ref, { bucket, prefix: "reports" });
      const page = await port.listObjects(ref, {
        bucket,
        prefix: "",
        delimiter: "/",
        maxKeys: 100,
      });
      expect(page.prefixes.map((entry) => entry.prefix)).toEqual(["logs/", "reports/"]);
    });

    it("replaces an object's tags", async () => {
      await expect(
        port.putTags(ref, { bucket, key: "readme.txt", tags: { team: "storage" } }),
      ).resolves.toBeUndefined();
    });

    it("scans a prefix, matching as it goes, and rolls up what it saw", async () => {
      const controller = new AbortController();
      const matched: string[] = [];
      let last;
      for await (const chunk of port.scan(
        ref,
        { bucket, prefix: "logs/", pattern: "**/*.json", maxObjects: 1000, maxSeconds: 30 },
        controller.signal,
      )) {
        matched.push(...chunk.objects.map((entry) => entry.key));
        last = chunk;
      }
      expect(matched).toEqual(["logs/2026/01.json", "logs/2026/02.json"]);
      expect(last?.progress).toMatchObject({
        scanned: 3,
        matched: 2,
        done: true,
        truncated: false,
      });
      expect(last?.rollup.objectCount).toBe(2);
    });

    it("refuses every write while the app is read only", async () => {
      setReadOnly(true);
      const body = new TextEncoder().encode("x");
      await expect(
        port.putObject(ref, { bucket, key: "x", body, contentLength: 1, overwrite: false }),
      ).rejects.toBeInstanceOf(ReadOnlyModeError);
      await expect(port.createPrefix(ref, { bucket, prefix: "x/" })).rejects.toBeInstanceOf(
        ReadOnlyModeError,
      );
      await expect(
        port.deleteObjects(ref, { bucket, objects: [{ key: "readme.txt" }] }),
      ).rejects.toBeInstanceOf(ReadOnlyModeError);
    });
  });
}
