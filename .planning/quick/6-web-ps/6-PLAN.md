---
phase: quick-6
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [code/webapp/src/pages/Draw.tsx]
autonomous: true
requirements: []
user_setup: []

must_haves:
  truths:
    - "Random seed is displayed correctly in both web browser and PS plugin webview"
    - "Random seed values generated in handleGenerate are preserved during workflow compilation"
    - "compileWorkflowToPrompt does not overwrite pre-generated random seeds"
  artifacts:
    - path: "code/webapp/src/pages/Draw.tsx"
      provides: "Workflow compilation and random seed handling"
  key_links:
    - from: "handleGenerate random seed generation"
      to: "compileWorkflowToPrompt"
      via: "inputValues / latestInputValuesRef"
      pattern: "randomSeedUpdates|Generated random seed"
---

<objective>
Fix the random seed display issue where PS plugin webview shows incorrect random seeds while web browser works correctly.

Purpose: Ensure random seed values generated in handleGenerate are preserved through compileWorkflowToPrompt without being overwritten.
Output: Consistent random seed display in both web browser and PS plugin webview.
</objective>

<execution_context>
@C:/Users/Administrator/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/Administrator/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

## Problem Analysis

The random seed generation has TWO places that generate seeds:

1. **handleGenerate (lines 2303-2346):** Pre-generates random seeds BEFORE calling compileWorkflowToPrompt, stores them in inputValues
2. **compileWorkflowToPrompt (lines 1885-1912):** Generates NEW random seeds during compilation

The bug: compileWorkflowToPrompt OVERWRITES the pre-generated random seeds from inputValues with NEW random seeds.

## Root Cause

In compileWorkflowToPrompt at lines 1885-1898:
```javascript
widgets.forEach((widget: any, idx: number) => {
  // ...
  if (isSeedInput && widgetValues[idx + 1] === 'randomize') {
    const randomSeed = Math.floor(Math.random() * 1000000000000000);
    inputs[widgetName] = randomSeed;  // OVERWRITES value from inputValues!
  }
});
```

This unconditionally generates a new random seed and assigns it to inputs, ignoring any pre-existing value from inputValues.

## Why Browser vs PS Plugin Difference

The browser may have different timing or caching behavior that makes the issue appear inconsistently. The fix ensures consistency regardless of environment.

</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix compileWorkflowToPrompt to respect pre-generated random seeds</name>
  <files>code/webapp/src/pages/Draw.tsx</files>
  <action>
    In the `compileWorkflowToPrompt` function, modify the random seed generation logic (around lines 1885-1912) to CHECK if a value was already resolved from inputValues before generating a new random seed.

    The current code at lines 1885-1898:
    ```javascript
    widgets.forEach((widget: any, idx: number) => {
      const widgetName = typeof widget.name === 'string' ? widget.name : '';
      if (!widgetName) return;

      const widgetNameLower = widgetName.toLowerCase();
      const isSeedInput = widgetNameLower.includes('seed');
      if (isSeedInput && widgetValues[idx + 1] === 'randomize') {
        const randomSeed = Math.floor(Math.random() * 1000000000000000);
        inputs[widgetName] = randomSeed;
        console.log(`[Draw] Generated random seed for node ${nodeId}.${widgetName}: ${randomSeed}`);
      }
    });
    ```

    Should be changed to:
    ```javascript
    widgets.forEach((widget: any, idx: number) => {
      const widgetName = typeof widget.name === 'string' ? widget.name : '';
      if (!widgetName) return;

      const widgetNameLower = widgetName.toLowerCase();
      const isSeedInput = widgetNameLower.includes('seed');
      // Only generate new random seed if not already resolved from inputValues
      if (isSeedInput && widgetValues[idx + 1] === 'randomize' && inputs[widgetName] === undefined) {
        const randomSeed = Math.floor(Math.random() * 1000000000000000);
        inputs[widgetName] = randomSeed;
        console.log(`[Draw] Generated random seed for node ${nodeId}.${widgetName}: ${randomSeed}`);
      }
    });
    ```

    Similarly, update the fallback logic for nodes with inputs array but no widgets (around lines 1900-1912):
    ```javascript
    if (widgets.length === 0 && Array.isArray(node.inputs) && widgetValues.length >= 2 && widgetValues[1] === 'randomize') {
      node.inputs.forEach((input: any) => {
        const inputName = input?.name;
        if (!inputName) return;
        const inputNameLower = inputName.toLowerCase();
        // Only generate new random seed if not already resolved from inputValues
        if (inputNameLower.includes('seed') && inputs[inputName] === undefined) {
          const randomSeed = Math.floor(Math.random() * 1000000000000000);
          inputs[inputName] = randomSeed;
          console.log(`[Draw] Generated random seed for node ${nodeId}.${inputName} (from inputs array): ${randomSeed}`);
        }
      });
    }
    ```

    The key change is adding `&& inputs[widgetName] === undefined` (or `&& inputs[inputName] === undefined`) to the condition. This ensures that if a value was already resolved from inputValues (which contains the pre-generated random seed from handleGenerate), it won't be overwritten.
  </action>
  <verify>
    <automated>grep -n "inputs\[widgetName\] === undefined" code/webapp/src/pages/Draw.tsx</automated>
  </verify>
  <done>compileWorkflowToPrompt respects pre-generated random seeds from inputValues and only generates new seeds when no value exists</done>
</task>

</tasks>

<verification>
1. Open the webapp in a browser
2. Select a workflow with RandomNoise node (e.g., "光影重绘")
3. Click generate
4. Verify console shows random seed generated ONCE (either from handleGenerate OR compileWorkflowToPrompt, not both)
5. Verify the random seed displayed in the UI matches the one sent to ComfyUI
6. In PS plugin webview, repeat steps 2-5 and verify same behavior
</verification>

<success_criteria>
- Random seed is generated only once per generation
- compileWorkflowToPrompt does not overwrite pre-generated random seeds from inputValues
- Both web browser and PS plugin webview show consistent random seed behavior
</success_criteria>

<output>
After completion, create `.planning/quick/6-web-ps/6-SUMMARY.md`
</output>
