import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as persistence from '../src/persistence.js';

describe('browser storage resolution', () => {
  it('returns null instead of throwing when the getter is denied', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw Object.assign(new Error('denied'), { name: 'SecurityError' });
      },
    });
    try {
      assert.equal(persistence.resolveStorage(), null);
      const p = persistence.createPersistence();
      assert.doesNotThrow(() => p.load());
      assert.equal(p.status().status, 'unavailable');
      const explicit = persistence.createPersistence({ storage: null });
      assert.doesNotThrow(() => explicit.load());
      assert.equal(explicit.status().status, 'unavailable');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else delete globalThis.localStorage;
    }
  });

  it('an explicit null storage never re-reads the throwing global getter', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let reads = 0;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        reads += 1;
        throw new Error('must not be read');
      },
    });
    try {
      const p = persistence.createPersistence({ storage: null });
      p.load();
      assert.equal(p.status().status, 'unavailable');
      assert.equal(reads, 0);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else delete globalThis.localStorage;
    }
  });
});
