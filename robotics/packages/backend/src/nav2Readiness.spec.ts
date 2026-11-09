import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { HUMBLE_NAV2_READINESS_PYTHON } from './nav2Readiness';

// Execute the shipped Python, with virtual wall time and ROS endpoints. A late
// transform appears only if the SAME listener survives discovery for >5 seconds.
const ROS_STUBS = String.raw`
import sys, types, time, json
from types import SimpleNamespace as NS
config = json.loads(sys.argv.pop(1))
now = 0.0
counts = dict(nodes=0, listeners=0, requests=0, removed=0, cancelled=0, unregistered=0, destroyed=0)
time.monotonic = lambda: now
def module(name, **values):
    result = types.ModuleType(name)
    result.__dict__.update(values)
    sys.modules[name] = result
    return result
class Future:
    def __init__(self): self.created = now
    def done(self): return not config.get('hung') and now - self.created >= 0.1
    def result(self):
        active = now >= config.get('active_at', 0)
        return NS(current_state=NS(id=config.get('state_id', 3 if active else 2),
                                  label='active' if active else 'inactive'))
    def cancel(self): counts['cancelled'] += 1
class Client:
    def service_is_ready(self): return now >= config.get('service_at', 0)
    def call_async(self, request):
        counts['requests'] += 1
        return Future()
    def remove_pending_request(self, future): counts['removed'] += 1
class Node:
    def __init__(self, name, **kwargs):
        counts['nodes'] += 1
        assert kwargs['cli_args'] == ['--ros-args', '-p', 'use_sim_time:=true',
            '-r', '/tf:=/robot_1/tf', '-r', '/tf_static:=/robot_1/tf_static']
    def create_client(self, kind, name):
        assert name == '/robot_1/bt_navigator/get_state'
        return Client()
    def destroy_node(self): counts['destroyed'] += 1
class Buffer:
    def __init__(self, node): pass
    def can_transform(self, parent, child, stamp):
        assert (parent, child) == ('map', 'base_link')
        return now >= config.get('tf_at', 0) and not config.get('missing_tf')
class Listener:
    def __init__(self, buffer, node): counts['listeners'] += 1
    def unregister(self): counts['unregistered'] += 1
def spin_once(node, timeout_sec):
    global now
    now += timeout_sec
def shutdown():
    assert counts['nodes'] == counts['listeners'] == counts['unregistered'] == counts['destroyed'] == 1
    print('CLEANUP ' + json.dumps(dict(counts, elapsed=now)))
module('rclpy', init=lambda **kw: None, ok=lambda: True, spin_once=spin_once, shutdown=shutdown)
module('rclpy.node', Node=Node)
module('rclpy.time', Time=lambda: None)
module('lifecycle_msgs')
module('lifecycle_msgs.srv', GetState=NS(Request=lambda: None))
module('tf2_ros', Buffer=Buffer, TransformListener=Listener)
`;

function probe(config: Record<string, unknown>, seconds = 12) {
  const result = spawnSync(
    'python3',
    ['-c', ROS_STUBS + HUMBLE_NAV2_READINESS_PYTHON, JSON.stringify(config), 'robot_1', String(seconds)],
    { encoding: 'utf8', timeout: 5000 },
  );
  expect(result.error).toBeUndefined();
  const cleanup = result.stdout.split('\n').find(line => line.startsWith('CLEANUP '));
  expect(cleanup, result.stderr).toBeDefined();
  return { ...result, stats: JSON.parse(cleanup!.slice(8)) };
}

describe('Humble persistent Nav2 readiness probe', () => {
  it('retains a single listener through delayed discovery beyond five seconds', () => {
    const result = probe({ tf_at: 7.1 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PHYSICAL_AI_NAV2_READY\n');
    expect(result.stats.elapsed).toBeGreaterThanOrEqual(7.1);
    expect(result.stats.listeners).toBe(1);
  });

  it('waits for a fresh active navigator response even when TF is already available', () => {
    const result = probe({ active_at: 8, service_at: 2 });
    expect(result.status).toBe(0);
    expect(result.stats.elapsed).toBeGreaterThanOrEqual(8);
    expect(result.stats.requests).toBeGreaterThan(1);
  });

  it.each([{ missing_tf: true }, { active_at: 100 }, { state_id: 2 }, { service_at: 100 }])(
    'fails closed at the wall-clock deadline: %j',
    config => {
      const result = probe(config);
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('PHYSICAL_AI_NAV2_READY');
      expect(result.stats.elapsed).toBeCloseTo(12);
    },
  );

  it('bounds and removes unanswered lifecycle requests without replacing the TF listener', () => {
    const result = probe({ hung: true });
    expect(result.status).toBe(1);
    expect(result.stats.removed).toBeGreaterThan(1);
    expect(result.stats.cancelled).toBe(result.stats.removed);
    expect(result.stats.requests).toBeLessThan(8);
  });
});
