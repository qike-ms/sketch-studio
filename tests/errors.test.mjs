import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as errors from '../src/errors.js';
import { validateScene } from '../src/schema.js';

describe('error boundary', () => {
  it('guards a failing handler and reports it', () => {
    const seen = [];
    const boundary = errors.createErrorBoundary({
      onError: (info) => seen.push(info),
      logger: { error: () => {} },
    });
    const result = boundary.guard(() => { throw new Error('boom'); }, 'render', 'fallback');
    assert.equal(result.ok, false);
    assert.equal(result.value, 'fallback');
    assert.equal(result.message, 'boom');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].label, 'render');
  });

  it('passes through successful work', () => {
    const boundary = errors.createErrorBoundary({ logger: { error: () => {} } });
    const result = boundary.guard(() => 42, 'ok');
    assert.equal(result.ok, true);
    assert.equal(result.value, 42);
  });

  it('guards async handlers', async () => {
    const boundary = errors.createErrorBoundary({ logger: { error: () => {} } });
    const failed = await boundary.guardAsync(async () => { throw new Error('async'); }, 'load', null);
    assert.equal(failed.ok, false);
    assert.equal(failed.message, 'async');
    const ok = await boundary.guardAsync(async () => 'done', 'load');
    assert.equal(ok.value, 'done');
  });

  it('never lets a broken logger or toast handler escape', () => {
    const boundary = errors.createErrorBoundary({
      onError: () => { throw new Error('toast broke'); },
      logger: { error: () => { throw new Error('log broke'); } },
    });
    const result = boundary.guard(() => { throw new Error('original'); }, 'x');
    assert.equal(result.ok, false);
    assert.equal(result.message, 'original');
  });

  it('describes strings and error objects', () => {
    assert.equal(errors.describeError('plain'), 'plain');
    assert.equal(errors.describeError(new Error('nope')), 'nope');
    assert.equal(errors.describeError(null), 'Unknown error');
  });
});

describe('toast store', () => {
  it('pushes, dismisses and caps the queue', () => {
    const store = errors.createToastStore({ max: 2 });
    const a = store.push('one');
    store.push('two');
    store.push('three');
    assert.equal(store.list().length, 2);
    assert.deepEqual(store.list().map((toast) => toast.message), ['two', 'three']);
    store.dismiss(a);
    assert.equal(store.list().length, 2, 'dismissing an evicted toast is a no-op');
    store.dismiss(store.list()[0].id);
    assert.equal(store.list().length, 1);
    store.clear();
    assert.equal(store.list().length, 0);
  });

  it('notifies subscribers and survives a throwing subscriber', () => {
    const store = errors.createToastStore();
    const seen = [];
    store.subscribe(() => { throw new Error('bad listener'); });
    const off = store.subscribe((list) => seen.push(list.length));
    store.push('hi');
    assert.deepEqual(seen, [1]);
    off();
    store.push('again');
    assert.deepEqual(seen, [1]);
  });

  it('keeps kind, detail and action metadata', () => {
    const store = errors.createToastStore();
    const id = store.push('Conflict', { kind: 'warning', detail: 'other tab', action: 'reload' });
    const toast = store.list().find((item) => item.id === id);
    assert.equal(toast.kind, 'warning');
    assert.equal(toast.detail, 'other tab');
    assert.equal(toast.action, 'reload');
  });
});

describe('recovery export', () => {
  it('builds a valid scene payload with error context', () => {
    const scene = { elements: [{ id: 'a', type: 'rect', x: 0, y: 0, width: 10, height: 10 }] };
    const payload = errors.buildRecoveryPayload(scene, { label: 'render', message: 'boom', theme: 'dark', style: { strokeColor: 'red' } }, 123);
    assert.equal(payload.version, 2);
    assert.equal(payload.recovery.label, 'render');
    assert.equal(payload.recovery.message, 'boom');
    assert.equal(payload.recovery.at, 123);
    assert.equal(payload.theme, 'dark');
    assert.equal(payload.style.strokeColor, 'red');
    const validated = validateScene(payload);
    assert.equal(validated.ok, true);
    assert.equal(validated.scene.elements.length, 1);
  });

  it('works with a missing scene and makes a timestamped filename', () => {
    const payload = errors.buildRecoveryPayload(null, {});
    assert.deepEqual(payload.elements, []);
    assert.equal(payload.version, 2);
    assert.match(errors.recoveryFilename(0), /^sketch-studio-recovery-\d{8}-\d{6}\.json$/);
  });
});
