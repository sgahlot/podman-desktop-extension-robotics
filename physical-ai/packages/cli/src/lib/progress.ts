import { Listr, type ListrTask } from 'listr2';

export interface ProgressStep {
  title: string;
  run: (onLine: (line: string) => void) => Promise<void>;
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
    // persistentOutput: without it, Listr2 clears the scrolling output window once a task
    // finishes — including on failure, which would hide exactly the context (e.g. the real
    // podman build error) a failed step most needs to leave visible.
    rendererOptions: { outputBar: step.outputBar ?? 1, persistentOutput: true },
    task: async (_ctx, task) => {
      await step.run(line => {
        task.output = line;
      });
    },
  }));

  await new Listr(tasks, { rendererOptions: { collapseSubtasks: false } }).run();
}
