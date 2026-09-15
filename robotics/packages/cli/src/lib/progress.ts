import { Listr, type ListrTask } from 'listr2';

export interface ProgressStep {
  title: string;
  /**
   * `setTitle` lets a step update its own displayed title once it learns something (e.g. an
   * architecture it just resolved) — the Listr-native way to surface a result that stays
   * visible after the run finishes. Don't use `this.log`/raw stdout for this from inside a
   * step: Listr2 owns the terminal's live-rendered region while running, and writing to it
   * directly would corrupt the redraw.
   */
  run: (onLine: (line: string) => void, setTitle: (title: string) => void) => Promise<void>;
  /**
   * Lines of output kept visible in a scrolling window under the task title while it runs —
   * mirrors Gradle/npm-style collapsed task output instead of dumping the full raw command
   * output into the terminal. Defaults to 1 (only the latest line).
   */
  outputBar?: number;
}

/**
 * Runs steps as a Listr2 task list. On failure, Listr2 rethrows the original error unwrapped
 * (verified: a task that `throw`s propagates the same Error out of `.run()`), so oclif's
 * default error handling in each command's `run()` still applies unmodified.
 */
export async function runWithProgress(steps: ProgressStep[]): Promise<void> {
  const tasks: ListrTask<Record<string, never>>[] = steps.map(step => ({
    title: step.title,
    // persistentOutput deliberately left at its default (false): a successful step should
    // collapse back down to just its checkmark + title, not leave 8 lines of raw podman
    // output lingering in the terminal. Failure context isn't lost by this — exec.ts's
    // PodmanCliError already embeds a tail of the real output directly in its thrown
    // message, which oclif prints regardless of how Listr rendered the task.
    rendererOptions: { outputBar: step.outputBar ?? 1 },
    task: async (_ctx, task) => {
      await step.run(
        line => {
          task.output = line;
        },
        title => {
          task.title = title;
        },
      );
    },
  }));

  await new Listr(tasks, { rendererOptions: { collapseSubtasks: false } }).run();
}
