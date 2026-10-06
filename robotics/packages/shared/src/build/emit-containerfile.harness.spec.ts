import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { buildLyricalRosDesktopSmokeContainerfile, buildPresetContainerfile } from './presetContainerfile';

/**
 * Integration helper — no-op in `npm test`. Set EMIT_CONTAINERFILE_MODE and EMIT_CONTAINERFILE_DIR
 * (see `scripts/integration/image-builder-presets.sh`).
 */
describe('emit-containerfile harness', () => {
  it('writes Containerfile when EMIT_CONTAINERFILE_* env is set', () => {
    const mode = process.env.EMIT_CONTAINERFILE_MODE;
    const dir = process.env.EMIT_CONTAINERFILE_DIR;
    if (!mode || !dir) return;

    mkdirSync(dir, { recursive: true });
    const content =
      mode === 'smoke'
        ? buildLyricalRosDesktopSmokeContainerfile()
        : mode === 'full'
          ? buildPresetContainerfile('fedora-bootc43-lyrical-amd64', 'amd64')
          : (() => {
              throw new Error(`Unknown EMIT_CONTAINERFILE_MODE: ${mode}`);
            })();
    writeFileSync(join(dir, 'Containerfile'), content, 'utf8');
  });
});
