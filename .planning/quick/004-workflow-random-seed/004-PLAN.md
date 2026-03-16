---
phase: quick-004
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
    - "User can view the workflow JSON being sent to ComfyUI"
    - "Random seed nodes automatically generate new random seeds on each generation"
    - "Console logs show the final prompt with randomized seeds"
  artifacts:
    - path: "code/webapp/src/pages/Draw.tsx"
      provides: "Workflow compilation and random seed handling"
      min_lines: 3000
  key_links:
    - from: "compileWorkflowToPrompt"
      to: "RandomNoise noise_seed"
      via: "random seed generation logic"
      pattern: "randomize.*seed|noise_seed.*random"
---

<objective>
Add debug logging to show the workflow JSON being sent to ComfyUI and ensure random seed nodes generate new random numbers on each execution.

Purpose: User needs visibility into what's actually being sent to ComfyUI and wants to understand the random seed mechanism.
Output: Console logs showing the final prompt JSON and proper random seed generation.
</objective>

<execution_context>
@C:/Users/Administrator/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/Administrator/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

## Current Understanding

### Workflow JSON Structure
Workflows loaded from ComfyUI contain nodes with `widgets_values`. For example, a `RandomNoise` node:

```json
{
  "id": 412,
  "type": "RandomNoise",
  "widgets_values": [619594677177448, "randomize"]
}
```

The second value `"randomize"` indicates the seed should be randomized.

### Compilation Flow (Draw.tsx)
1. `handleGenerate()` calls `compileWorkflowToPrompt(workflowData, currentInputValues)`
2. `compileWorkflowToPrompt` iterates through nodes and builds the prompt
3. Final prompt is sent to `{baseUrl}/prompt` via POST

### Key Code Locations
- `compileWorkflowToPrompt`: lines 1562-1962 in Draw.tsx
- `handleGenerate`: lines 2138-2358 in Draw.tsx
- Random seed handling: needs to check if "randomize" mode triggers new seed generation

</context>

<tasks>

<task type="auto">
  <name>Task 1: Add workflow JSON debug logging</name>
  <files>code/webapp/src/pages/Draw.tsx</files>
  <action>
    In the `handleGenerate` function (around line 2197), add console logging to show:
    1. The raw workflow JSON loaded from ComfyUI (workflowData)
    2. The final compiled prompt (finalPrompt) being sent to ComfyUI

    Add these console.log statements after the `finalPrompt` is constructed:
    ```typescript
    console.log('[Draw] Workflow data loaded:', JSON.stringify(workflowData, null, 2));
    console.log('[Draw] Final prompt sent to ComfyUI:', JSON.stringify(finalPrompt, null, 2));
    ```

    This will allow the user to see the exact JSON being sent in the browser console (F12).
  </action>
  <verify>
    <automated>grep -n "Final prompt sent to ComfyUI" code/webapp/src/pages/Draw.tsx</automated>
  </verify>
  <done>Console logs added showing workflow JSON and final prompt</done>
</task>

<task type="auto">
  <name>Task 2: Implement random seed generation for RandomNoise nodes</name>
  <files>code/webapp/src/pages/Draw.tsx</files>
  <action>
    In the `compileWorkflowToPrompt` function, add logic to handle random seed generation for nodes that have "randomize" mode.

    Look for where `widgets_values` is processed (around lines 1593-1760). For nodes with `noise_seed` or `seed` inputs where the second widget value is "randomize", generate a new random seed.

    Add this logic when processing widget values for seed-related inputs:
    ```typescript
    // For seed inputs with "randomize" mode, generate a new random seed
    const widgetName = widget.name?.toLowerCase() || '';
    const isSeedInput = widgetName.includes('seed');
    if (isSeedInput && widgetValues[idx + 1] === 'randomize') {
      const randomSeed = Math.floor(Math.random() * 1000000000000000);
      inputs[inputName] = randomSeed;
      console.log(`[Draw] Generated random seed for node ${nodeId}.${inputName}: ${randomSeed}`);
    }
    ```

    This ensures each generation uses a different seed when the workflow has "randomize" mode set.
  </action>
  <verify>
    <automated>grep -n "randomize" code/webapp/src/pages/Draw.tsx | head -20</automated>
  </verify>
  <done>Random seed nodes generate new random seeds on each execution when "randomize" mode is set</done>
</task>

</tasks>

<verification>
1. Open browser console (F12) in the webapp
2. Select a workflow with RandomNoise node (e.g., "光影重绘")
3. Click generate
4. Verify console shows:
   - "[Draw] Workflow data loaded:" with the workflow JSON
   - "[Draw] Final prompt sent to ComfyUI:" with the compiled prompt
   - "[Draw] Generated random seed for node X.noise_seed:" with a random number
5. Run generation again and verify the seed value changes
</verification>

<success_criteria>
- Console logs display the workflow JSON and final prompt
- Random seed nodes generate new seeds on each execution
- User can inspect the exact data being sent to ComfyUI
</success_criteria>

<output>
After completion, create `.planning/quick/004-workflow-random-seed/004-SUMMARY.md`
</output>
