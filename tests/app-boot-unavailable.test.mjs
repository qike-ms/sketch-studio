import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { installDomStub } from './helpers/dom-stub.mjs';

describe('boot with denied browser storage', () => {
  it('initialises the app and keeps in-memory editing usable', async () => {
    const dom = installDomStub();
    Object.defineProperty(dom.window, 'localStorage', {
      configurable: true,
      get() {
        throw Object.assign(new Error('denied'), { name: 'SecurityError' });
      },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'node-stub', clipboard: { readText: async () => '', writeText: async () => {} } },
    });

    await import('../assets/app.js');
    const app = dom.window.sketchStudio;
    assert.ok(app, 'the app booted despite the throwing storage getter');
    assert.ok(app.scene);
    assert.ok(app.toasts().some((toast) => /storage is unavailable/i.test(toast.message)));

    const saved = app.save();
    assert.equal(saved.ok, false);
    assert.equal(saved.unavailable, true);
    assert.equal(dom.get('saveStatus').textContent, 'Storage unavailable — in memory');
  });
});
