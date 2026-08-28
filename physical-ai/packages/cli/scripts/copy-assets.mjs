// Copies the extension's bundled Containerfile asset directories into this
// package so `build:base`/`build:sim` can resolve a build context without a
// Podman Desktop extensionContext. Source of truth stays packages/backend/assets/ —
// this is a build-time copy, not a shared reference. See docs/stories plan for
// the follow-up to converge on one shared assets location.
import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '..', '..', 'backend', 'assets');
const dest = path.join(here, '..', 'assets');

await rm(dest, { recursive: true, force: true });
await cp(source, dest, { recursive: true });
