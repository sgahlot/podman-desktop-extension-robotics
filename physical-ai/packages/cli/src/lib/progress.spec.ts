import { describe, expect, it, vi } from 'vitest';
import { runWithProgress } from './progress';

describe('runWithProgress', () => {
  it('runs each step in order, passing an onLine callback through', async () => {
    const calls: string[] = [];
    await runWithProgress([
      {
        title: 'step 1',
        run: async onLine => {
          calls.push('step1-start');
          onLine('step1-output');
        },
      },
      {
        title: 'step 2',
        run: async onLine => {
          calls.push('step2-start');
          onLine('step2-output');
        },
      },
    ]);

    expect(calls).toEqual(['step1-start', 'step2-start']);
  });

  it('propagates the original error unwrapped when a step fails', async () => {
    const boom = new Error('podman not found');
    await expect(
      runWithProgress([
        { title: 'ok step', run: async () => {} },
        {
          title: 'failing step',
          run: async () => {
            throw boom;
          },
        },
      ]),
    ).rejects.toThrow('podman not found');
  });

  it('does not run later steps once an earlier step fails', async () => {
    const laterStep = vi.fn(async () => {});
    await expect(
      runWithProgress([
        {
          title: 'failing step',
          run: async () => {
            throw new Error('fail');
          },
        },
        { title: 'later step', run: laterStep },
      ]),
    ).rejects.toThrow('fail');

    expect(laterStep).not.toHaveBeenCalled();
  });
});
