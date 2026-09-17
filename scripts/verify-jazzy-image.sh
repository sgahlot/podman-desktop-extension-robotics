#!/usr/bin/env bash
# Avoid `set -u` — zsh/pyenv hooks (e.g. _auto_run_venv) can trip on unset VIRTUAL_ENV.
set -eo pipefail
IMAGE="${1:-quay.io/sgahlot/ros2-jazzy-sim:noble-amd64}"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "Image: $IMAGE"
podman image inspect "$IMAGE" --format 'Created: {{.Created}} Arch: {{.Architecture}} Id: {{.Id}}'
echo ""
echo "Saving image layers (may take a minute)..."
podman save "$IMAGE" -o "$WORKDIR/img.tar"
cd "$WORKDIR"
tar -xf img.tar

VERIFY_PY="$WORKDIR/verify.py"
cat > "$VERIFY_PY" <<'PY'
import json, stat, tarfile
from pathlib import Path
from typing import Optional

with open('manifest.json') as f:
    layers = json.load(f)[0]['Layers']

root = Path('rootfs')
root.mkdir(exist_ok=True)

checks = [
    ('entrypoint-gazebo.sh', 'file'),
    ('entrypoint-spawn-robot.sh', 'file'),
    ('entrypoint-nav2.sh', 'file'),
    ('usr/local/lib/robotics/load-validate-input.sh', 'file'),
    ('usr/local/lib/robotics/validate-input.sh', 'file'),
    ('usr/local/lib/robotics/patch-nav2-params.py', 'file'),
    ('usr/local/lib/physical-ai/load-validate-input.sh', 'absent'),
    ('opt/ros2-demo/worlds/tb3_sandbox.sdf.xacro', 'file'),
    ('opt/ros2-demo/config/cyclonedds-qos.xml', 'file'),
    ('opt/ros2-demo/www', 'dir'),
    ('usr/share/novnc/index.html', 'file'),
]

tracked = {rel for rel, _ in checks}
tracked_dirs = {rel for rel, kind in checks if kind == 'dir'}

def layer_path_is_tracked(name: str) -> bool:
    if name in tracked or name in tracked_dirs:
        return True
    return any(name.startswith(t + '/') or t.startswith(name + '/') for t in tracked | tracked_dirs)

def whiteout_target(name: str) -> Optional[str]:
    base = name.split('/')[-1]
    if not base.startswith('.wh.'):
        return None
    parent = '/'.join(name.split('/')[:-1])
    rel = base[4:]
    return f'{parent}/{rel}' if parent else rel

# Latest layer wins — only materialize paths we verify (skip etc/gshadow, etc.).
files: dict[str, tuple[bytes, int]] = {}
dirs: set[str] = set()

for layer in layers:
    with tarfile.open(layer) as lt:
        for m in lt.getmembers():
            name = m.name.lstrip('./')
            wo = whiteout_target(name)
            if wo is not None:
                if layer_path_is_tracked(wo):
                    files.pop(wo, None)
                    dirs.discard(wo)
                continue
            if not layer_path_is_tracked(name):
                continue
            if m.isdir():
                dirs.add(name)
                files.pop(name, None)
            elif m.isfile():
                f = lt.extractfile(m)
                if f:
                    files[name] = (f.read(), m.mode)
                dirs.discard(name)

for name, (data, mode) in files.items():
    dest = root / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    dest.chmod(mode)

for name in dirs:
    (root / name).mkdir(parents=True, exist_ok=True)

print('=== Path checks ===')
ok = True
for rel, kind in checks:
    p = root / rel
    if kind == 'absent':
        good = not p.exists()
        print(f'{"OK" if good else "FAIL":4} /{rel} (should be absent)')
        ok = ok and good
    elif kind == 'dir':
        good = p.is_dir()
        print(f'{"OK" if good else "FAIL":4} /{rel}/')
        ok = ok and good
    else:
        good = p.is_file()
        exe = p.stat().st_mode & stat.S_IXUSR if good else 0
        print(f'{"OK" if good else "FAIL":4} /{rel}' + (f' (+x)' if exe else ' (no +x)' if good else ''))
        ok = ok and good

ep = (root / 'entrypoint-gazebo.sh').read_text()
print('\n=== entrypoint-gazebo.sh ===')
print('  ROBOTICS_USE_GPU:', 'ROBOTICS_USE_GPU' in ep)
print('  PHYSICAL_AI_USE_GPU:', 'PHYSICAL_AI_USE_GPU' in ep)
print('  robotics lib fallback:', '/usr/local/lib/robotics/load-validate-input.sh' in ep)
print('  physical-ai lib fallback:', '/usr/local/lib/physical-ai/' in ep)
gz_distro_aware = 'pai_export_gz_sim_resource_path' in ep
gz_jazzy_hardcoded = 'GZ_SIM_RESOURCE_PATH="/opt/ros/jazzy/share' in ep
print('  GZ_SIM_RESOURCE_PATH distro-aware:', gz_distro_aware)
if gz_jazzy_hardcoded and not gz_distro_aware:
    print('  WARN: hardcoded /opt/ros/jazzy GZ_SIM_RESOURCE_PATH — non-Jazzy images will show a black viewer')
    ok = False

loader = (root / 'usr/local/lib/robotics/load-validate-input.sh').read_text()
validate = root / 'usr/local/lib/robotics/validate-input.sh'
print('\n=== lib chain ===')
print('  validate-input.sh exists:', validate.is_file())
print('  loader references same-dir validate:', '_pai_here}/validate-input.sh' in loader)

print('\n=== RESULT ===')
print('PASS' if ok else 'FAIL')
raise SystemExit(0 if ok else 1)
PY

# Prefer system Python — avoids zsh/pyenv wrappers that reference unset VIRTUAL_ENV.
if [[ -x /usr/bin/python3 ]]; then
  /usr/bin/python3 "$VERIFY_PY"
else
  command -v python3 >/dev/null && env -u VIRTUAL_ENV python3 "$VERIFY_PY"
fi
