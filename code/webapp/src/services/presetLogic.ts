// Preset logic — pure functions for preset dirty-state detection.
//
// Extracted from presetStore.ts. The store used to lock this inside a Zustand
// callback where the "last applied" baseline had to be read via `get()`.
// Pulling it out makes the comparison logic testable in isolation.

/**
 * Decide whether the current input/image values differ from the last applied
 * preset (the "dirty" check that drives the unsaved-changes warning).
 *
 * Returns `true` if any input value or image filename differs between the
 * current state and the last applied baseline. Returns `false` when:
 *   - no baseline has ever been applied (both inputs and images are null)
 *   - all current values match the baseline
 *
 * The comparison uses `!==` (strict equality), so it correctly detects
 * string-to-number coercion issues, NaN, and undefined → value transitions.
 */
export function hasUnsavedChanges(
  lastAppliedInputValues: Record<string, string | number | boolean> | null | undefined,
  lastAppliedImageFilenames: Record<string, string> | null | undefined,
  currentInputValues: Record<string, string | number | boolean>,
  currentImageFilenames: Record<string, string>
): boolean {
  // No baseline to compare against
  if (!lastAppliedInputValues && !lastAppliedImageFilenames) {
    return false;
  }

  // Compare inputValues — any differing key counts as dirty
  const allInputKeys = new Set([
    ...Object.keys(lastAppliedInputValues || {}),
    ...Object.keys(currentInputValues),
  ]);
  for (const key of allInputKeys) {
    const applied = lastAppliedInputValues?.[key];
    const current = currentInputValues[key];
    if (applied !== current) return true;
  }

  // Compare imageFilenames
  const allImageKeys = new Set([
    ...Object.keys(lastAppliedImageFilenames || {}),
    ...Object.keys(currentImageFilenames),
  ]);
  for (const key of allImageKeys) {
    const applied = lastAppliedImageFilenames?.[key];
    const current = currentImageFilenames[key];
    if (applied !== current) return true;
  }

  return false;
}
