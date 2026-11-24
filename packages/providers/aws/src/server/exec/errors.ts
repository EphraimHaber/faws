/**
 * The exec error, with its code narrowed to the ones the client knows how to
 * explain. The host recognises it by the `@faws/kit/server` base class.
 */
import type { ExecErrorCode } from "@faws/contracts";
import { ExecSessionError as KitExecSessionError } from "@faws/kit/server";

export class ExecSessionError extends KitExecSessionError<ExecErrorCode> {}
