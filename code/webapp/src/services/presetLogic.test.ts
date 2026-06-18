// Unit tests for the Preset Logic module.

import { describe, expect, it } from 'vitest';
import { hasUnsavedChanges } from './presetLogic';

// ---------------------------------------------------------------------------
// Baseline absence
// ---------------------------------------------------------------------------

describe('hasUnsavedChanges — no baseline', () => {
  it('returns false when both inputs and images baselines are null', () => {
    expect(hasUnsavedChanges(null, null, { steps: 20 }, { img: 'cat.png' })).toBe(false);
  });

  it('returns false when both inputs and images baselines are undefined', () => {
    expect(hasUnsavedChanges(undefined, undefined, { steps: 20 }, {})).toBe(false);
  });

  it('returns false when baselines are null and current is empty', () => {
    expect(hasUnsavedChanges(null, null, {}, {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Input value comparison
// ---------------------------------------------------------------------------

describe('hasUnsavedChanges — input values', () => {
  it('returns true when a value differs', () => {
    expect(hasUnsavedChanges(
      { steps: 20, cfg: 7 },
      null,
      { steps: 30, cfg: 7 },  // steps changed
      {}
    )).toBe(true);
  });

  it('returns false when all values match', () => {
    expect(hasUnsavedChanges(
      { steps: 20, cfg: 7 },
      null,
      { steps: 20, cfg: 7 },
      {}
    )).toBe(false);
  });

  it('returns true when a key is added to current values', () => {
    expect(hasUnsavedChanges(
      { steps: 20 },
      null,
      { steps: 20, cfg: 7 },  // cfg added
      {}
    )).toBe(true);
  });

  it('returns true when a key is removed from current values', () => {
    expect(hasUnsavedChanges(
      { steps: 20, cfg: 7 },
      null,
      { steps: 20 },  // cfg removed
      {}
    )).toBe(true);
  });

  it('uses strict equality — "20" !== 20', () => {
    expect(hasUnsavedChanges(
      { steps: 20 },
      null,
      { steps: '20' as any },  // type mismatch
      {}
    )).toBe(true);
  });

  it('detects type changes for booleans', () => {
    expect(hasUnsavedChanges(
      { enabled: true },
      null,
      { enabled: false },
      {}
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Image filename comparison
// ---------------------------------------------------------------------------

describe('hasUnsavedChanges — image filenames', () => {
  it('returns true when a filename differs', () => {
    expect(hasUnsavedChanges(
      null,
      { upload: 'cat.png' },
      {},
      { upload: 'dog.png' }
    )).toBe(true);
  });

  it('returns false when all filenames match', () => {
    expect(hasUnsavedChanges(
      null,
      { upload: 'cat.png' },
      {},
      { upload: 'cat.png' }
    )).toBe(false);
  });

  it('returns true when an image key is added', () => {
    expect(hasUnsavedChanges(
      null,
      {},
      {},
      { upload: 'cat.png' }
    )).toBe(true);
  });

  it('returns true when an image key is removed', () => {
    expect(hasUnsavedChanges(
      null,
      { upload: 'cat.png' },
      {},
      {}
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined checks
// ---------------------------------------------------------------------------

describe('hasUnsavedChanges — combined', () => {
  it('returns true if only inputs differ (images match)', () => {
    expect(hasUnsavedChanges(
      { steps: 20, image: 'a.png' },
      { image: 'a.png' },
      { steps: 30, image: 'a.png' },
      { image: 'a.png' }
    )).toBe(true);
  });

  it('returns true if only images differ (inputs match)', () => {
    expect(hasUnsavedChanges(
      { steps: 20, image: 'a.png' },
      { image: 'a.png' },
      { steps: 20, image: 'a.png' },
      { image: 'b.png' }
    )).toBe(true);
  });

  it('checks inputs first (short-circuits on input mismatch)', () => {
    // Even if images also differ, returning true on first mismatch is fine
    expect(hasUnsavedChanges(
      { steps: 20 },
      { image: 'a.png' },
      { steps: 30 },           // inputs differ
      { image: 'b.png' }       // images differ too
    )).toBe(true);
  });

  it('handles mixed presence of baselines — inputs match but current has new images', () => {
    // When the input baseline is set and matches, but the current images have
    // entries not in the (null) image baseline, the image comparison flags dirty.
    // This is intentional: a new image upload should be considered a change.
    expect(hasUnsavedChanges(
      { steps: 20 },
      null,  // no image baseline
      { steps: 20 },
      { image: 'a.png' }       // current has a new image → dirty
    )).toBe(true);
  });

  it('handles mixed presence of baselines — both null is the only "no dirty" case', () => {
    // Only when both baselines are null (nothing has ever been applied)
    // is the result guaranteed clean regardless of current values.
    expect(hasUnsavedChanges(
      null,
      null,
      { steps: 99, image: 'whatever.png' } as any,
      { image: 'whatever.png' }
    )).toBe(false);
  });
});
