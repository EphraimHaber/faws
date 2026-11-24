/**
 * Starting an SSM shell in bash, for someone who asked for it.
 *
 * Session Manager's default document runs `sh` as `ssm-user` in `/usr/bin`.
 * On Ubuntu that is dash, which has no line editing at all - no completion,
 * no history, Tab inserts a tab - and it matches what `aws ssm start-session`
 * does, which is why it stays the default. This is the opt-in way round it,
 * through the one standard document that runs a command of our choosing.
 */

/** The request `StartSession` is sent, and the plugin is handed back. */
export interface StartRequest {
  readonly Target: string;
  readonly DocumentName?: string;
  readonly Parameters?: Record<string, string[]>;
}

const INTERACTIVE_DOCUMENT = "AWS-StartInteractiveCommand";

/**
 * Run by the agent as `sh -c`. Home first, because the default shell's
 * `/usr/bin` is nobody's working directory; `sh` where the image has no bash,
 * so asking for bash never costs someone their shell.
 */
export const BASH_COMMAND =
  "cd; if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh; fi";

/**
 * Starts the session in bash where that can work, and in the default shell
 * where it cannot.
 *
 * Only Linux and macOS instances are asked: the command is a POSIX shell line,
 * and on Windows the document runs PowerShell. A policy that allows the default
 * document but not this one is common, so a refusal of this document falls
 * back rather than failing - the person asked for a nicer shell, not for no
 * shell at all - and says why through `onFallback`.
 */
export async function startPreferringBash<T>(
  start: (request: StartRequest) => Promise<T>,
  instanceId: string,
  platformType: string | undefined,
  onFallback: (why: string) => void,
): Promise<{ started: T; request: StartRequest }> {
  const plain: StartRequest = { Target: instanceId };
  if (platformType !== "Linux" && platformType !== "MacOS") {
    return { started: await start(plain), request: plain };
  }

  const bash: StartRequest = {
    Target: instanceId,
    DocumentName: INTERACTIVE_DOCUMENT,
    Parameters: { command: [BASH_COMMAND] },
  };
  try {
    return { started: await start(bash), request: bash };
  } catch (err) {
    if ((err as { name?: string }).name !== "AccessDeniedException") throw err;
    onFallback(
      `This account does not allow ${INTERACTIVE_DOCUMENT}, so this is the default shell rather than bash.`,
    );
    return { started: await start(plain), request: plain };
  }
}
