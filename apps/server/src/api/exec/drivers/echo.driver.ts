/**
 * A driver that talks to nothing.
 *
 * It exists so the whole socket path - handshake parsing, binary frames, xterm
 * rendering, resize, teardown - can be exercised without AWS credentials, a
 * reachable host, or the session-manager-plugin installed. When a terminal
 * misbehaves this is the first thing to try: if the echo session is wrong too,
 * the bug is in the transport rather than in a driver.
 *
 * Off unless `FAWS_EXEC_DEV_ECHO=1`, and registered for every kind when it is,
 * because the point is to stand in for whichever driver you are debugging.
 */
import type { ExecDriver, ExecDriverFactory } from "../exec.service.ts";

const encoder = new TextEncoder();

const CR = 0x0d;
const DEL = 0x7f;
const BACKSPACE = 0x08;
/** Below this are control codes, which a line editor this small ignores. */
const FIRST_PRINTABLE = 0x20;

export const echoDriverFactory: ExecDriverFactory = async (auth, sink, ctx) => {
  let cols = auth.cols;
  let rows = auth.rows;
  let closed = false;
  let line = "";

  const send = (text: string) => sink.data(encoder.encode(text));
  const prompt = () => send("\r\n[32mecho[0m$ ");

  ctx.log.info("echo driver started");
  send(`[1mfaws echo driver[0m (${auth.kind}, ${cols}x${rows})\r\n`);
  send("Nothing is connected. Type to see bytes come back; `exit` ends it.\r\n");
  send("`size` prints the geometry the server last heard.");
  prompt();

  const driver: ExecDriver = {
    write(chunk) {
      if (closed) return;
      for (const byte of chunk) {
        if (byte === CR) {
          const command = line.trim();
          line = "";
          if (command === "exit") {
            send("\r\n");
            closed = true;
            sink.exit(0, "echo driver: exit");
            return;
          }
          if (command === "size") send(`\r\n${cols}x${rows}`);
          else if (command.length > 0) send(`\r\n${command}`);
          prompt();
        } else if (byte === DEL || byte === BACKSPACE) {
          if (line.length === 0) continue;
          line = line.slice(0, -1);
          // Left, overwrite with a space, left again.
          send("\b \b");
        } else if (byte >= FIRST_PRINTABLE) {
          const char = String.fromCharCode(byte);
          line += char;
          send(char);
        }
      }
    },
    resize(nextCols, nextRows) {
      cols = nextCols;
      rows = nextRows;
      ctx.log.debug({ cols, rows }, "echo driver resized");
    },
    close(reason) {
      if (closed) return;
      closed = true;
      ctx.log.info({ reason }, "echo driver closed");
    },
  };

  return driver;
};
