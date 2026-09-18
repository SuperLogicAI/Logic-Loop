import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";

/**
 * dsh-terminal-app/startup — parses this profile's own CLI flags and
 * publishes them as the `terminalStartup` service, the same pattern
 * @deepseek-ai/dsh-headless/startup uses for its `[task...]` positional.
 */

const name = "terminal-startup";
const inject = ["cmdlineArgs"];
const TERMINAL_STARTUP_SERVICE = "terminalStartup";

function terminalCommand() {
  return new Command()
    .name("dsh --profile <name>")
    .description(
      "Interactive terminal chat over a DeepSeek Harness agent/session.",
    )
    .helpOption("-h, --help", "show this help")
    .option(
      "--resume <sessionId>",
      "resume an existing session id instead of starting a new one",
    )
    .addHelpText(
      "after",
      `
Examples:
  dsh --profile logic-loop                        start a new interactive session
  dsh --profile logic-loop --resume session-1234   resume an existing session
`,
    );
}

function apply(ctx) {
  const program = terminalCommand();
  program.action(() => {
    const opts = program.opts();
    ctx.provide(TERMINAL_STARTUP_SERVICE, { resumeSessionId: opts.resume });
  });
  parseCmdline(ctx, program);
}

export { TERMINAL_STARTUP_SERVICE, apply, inject, name };
