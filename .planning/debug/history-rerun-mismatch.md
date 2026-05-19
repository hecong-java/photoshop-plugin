---
status: resolved
trigger: "When clicking '重新运行' (re-run) or '重新编辑' (re-edit) in history, both the workflow and parameters are incorrect - not matching the original history entry."
created: 2026-03-17T00:00:00.000Z
updated: 2026-03-24T00:00:00.000Z
---

## Current Focus

status: RESOLVED
resolution: Race condition between fetchWorkflows and history action was causing default workflow to overwrite the correctly matched workflow from history.

## Root Cause

**Race Condition**: When the page loads with a history action (rerun/edit):
1. `fetchWorkflows` completes and checks `!selectedWorkflow`
2. Simultaneously, the history useEffect triggers and calls `handleWorkflowSelect`
3. Due to React's async state updates, `selectedWorkflow` is still undefined when `fetchWorkflows` checks
4. `fetchWorkflows` then selects the default workflow, overwriting the history action

## Fix Applied

Modified `fetchWorkflows` in Draw.tsx to check for pending history actions before selecting default workflow:

```javascript
const hasPendingHistoryAction = hasHandledHistoryAction.current ||
  sessionStorage.getItem('rerunItem') ||
  sessionStorage.getItem('editItem');

if (!selectedWorkflow && !hasPendingHistoryAction) {
  // Select default workflow only if no history action is pending
}
```

## Files Changed

- `code/webapp/src/pages/Draw.tsx`

## Symptoms

expected: Both workflow and parameters should match the history entry being re-run/re-edited
actual: Both workflow and parameters are incorrect - wrong workflow loaded, wrong/missing parameters
errors: None reported
reproduction: Click re-run or re-edit button on any history entry
started: Unknown when this started
scope: Both PS plugin webview and standalone web browser

## Eliminated

- hypothesis: workflow_name not being stored in history
  evidence: User confirmed workflow_name IS stored correctly: "增强与编辑/光影重绘.json" (from prior session)
  timestamp: 2026-03-23T10:00:00.000Z

## Evidence

- timestamp: 2026-03-17T00:00:00.000Z
  checked: History.tsx handleRerun and handleReEdit functions
  found: Both functions pass the full HistoryItem to Draw page via navigate() with state. The HistoryItem contains workflowName (string) and params (Record<string, unknown>).
  implication: The data flow is correct - the issue is likely in how workflowName and params are populated in historyStore

- timestamp: 2026-03-17T00:00:00.000Z
  checked: historyStore.ts convertEntryToItem function
  found: workflowName is extracted from extraData.workflow_name if available, otherwise falls back to imageInfo.imageName (the filename of the output image!). params is set to promptData which is extracted from promptTuple[2] (the workflow dict).
  implication: CRITICAL - If ComfyUI doesn't store workflow_name in extra_data, the workflowName becomes the IMAGE filename, not the workflow name. This would cause findBestMatchingWorkflow to fail to match the correct workflow.

- timestamp: 2026-03-17T00:00:00.000Z
  checked: Draw.tsx findBestMatchingWorkflow function
  found: The function uses workflow name matching with +50 score boost for exact match. If workflowName is actually an image filename like "ComfyUI_00001.png", the isWorkflowName check (line 701-702) would detect this and not apply the match bonus.
  implication: The workflow matching would rely entirely on node type matching, which could select the wrong workflow if multiple workflows have similar node types.

- timestamp: 2026-03-17T00:00:00.000Z
  checked: Draw.tsx extractInputValuesFromHistoryParams function (lines 387-492)
  found: The function extracts nodeId from input.name (format: "{inputName}_{nodeId}") at line 405, then looks up promptData[nodeId] at line 408. If the nodeId doesn't exist in the history params (because it's from a different workflow), the lookup returns undefined and no value is restored.
  implication: ROOT CAUSE CONFIRMED - When the wrong workflow is selected, its node IDs don't match the node IDs in the history params, so parameter restoration fails completely.

- timestamp: 2026-03-17T00:00:00.000Z
  checked: Draw.tsx parseWorkflowInputs function (lines 1009+)
  found: Input names are constructed as `{inputName}_{nodeId}` where nodeId comes from the workflow JSON (e.g., "image_3", "text_5"). These node IDs are specific to each workflow and will differ between workflows.
  implication: Even if workflows have the same types of nodes (LoadImage, CLIPTextEncode, etc.), they will have different node IDs, making the current matching approach fundamentally broken for cross-workflow parameter restoration.

- timestamp: 2026-03-17T00:00:00.000Z
  checked: User feedback on previous fix attempt
  found: User reported workflow matching is still problematic. The scoring-based approach doesn't reliably select the correct workflow. User suggested: match by workflow_name first, then pass parameters to that matched workflow.
  implication: Need to restructure findBestMatchingWorkflow to prioritize workflow_name matching over node type/ID scoring.

- timestamp: 2026-03-17T00:00:00.000Z
  checked: Draw.tsx findBestMatchingWorkflow function implementation
  found: Implemented new approach: (1) Check if workflowName looks like a workflow name (not image filename), (2) Try exact match by normalizing both names, (3) Try partial match if no exact match, (4) Only fall back to scoring if no name match. This prioritizes the stored workflow_name from history.
  implication: The correct workflow should now be selected based on workflow_name, and parameters will be restored to that specific workflow.

- timestamp: 2026-03-17T13:00:00.000Z
  checked: User feedback - fix still not working
  found: User confirmed the previous fix did not resolve the issue. Workflow matching is still not working correctly.
  implication: Need to investigate more deeply - either workflow_name is not being stored, or the matching logic has edge cases

- timestamp: 2026-03-17T13:00:00.000Z
  checked: findBestMatchingWorkflow isWorkflowName check (line 639-640)
  found: BUG - The check `normalized.endsWith('.json')` is ALWAYS false because `.json` was already stripped on line 637. This means the logic relies entirely on the image extension check.
  implication: The isWorkflowName check might incorrectly classify valid workflow names as image filenames

- timestamp: 2026-03-17T13:00:00:000Z
  checked: Workflow name format in workflow list vs stored name
  found: Workflow names from listWorkflows can include path prefix (e.g., "ps-workflows/workflow-name.json") but stored workflow_name might be just "workflow-name.json" (from selectedWorkflow.name)
  implication: Need to normalize both names to just the base filename for comparison

- timestamp: 2026-03-17T15:00:00.000Z
  checked: User-provided actual history data structure
  found: workflow_name IS stored correctly at prompt[3].workflow_name = "增强与编辑/光影重绘.json". The historyStore correctly extracts this from the tuple structure.
  implication: The issue is NOT in history storage - workflow_name is being stored and extracted correctly

- timestamp: 2026-03-17T15:00:00.000Z
  checked: findBestMatchingWorkflow normalization logic
  found: The code normalizes both sides: (1) workflowName from history: "增强与编辑/光影重绘.json" → normalized="增强与编辑/光影重绘" → baseName="光影重绘" (2) w.name from list: same process. The matching checks both pathMatch (full path match) and baseMatch (base filename match).
  implication: The matching logic SHOULD work if both sides use consistent path formats. Need to verify actual workflow list format.

- timestamp: 2026-03-17T15:00:00.000Z
  checked: Workflow list format from ComfyUI API
  found: parseWorkflowList returns { name: item, path: item } for string items from API. The encodeWorkflowPath function adds "ps-workflows/" prefix if not present when reading, suggesting API might return names WITHOUT this prefix.
  implication: If API returns "增强与编辑/光影重绘.json" (no ps-workflows prefix), and this is stored as workflow_name, then matching should work. But if API returns DIFFERENT format, matching could fail.

- timestamp: 2026-03-17T15:15:00.000Z
  checked: Path separator handling in findBestMatchingWorkflow
  found: The code only splits by "/" but on Windows, paths might use "\". This would cause the baseName extraction to fail for Windows-style paths.
  implication: Added .replace(/\\/g, '/') to normalize both sides before comparison. Also added char code logging for detailed debugging.

- timestamp: 2026-03-23T10:00:00.000Z
  checked: How workflow_name is stored when prompt is submitted
  found: In handleGenerate (line 2559), workflow_name is set to `currentWorkflow?.name || ''`. The currentWorkflow comes from selectedWorkflow, which is set from the workflow list returned by listWorkflows.
  implication: The workflow_name stored in history should match the format returned by the API. If the API returns names with `ps-workflows/` prefix, the stored name would have this prefix too.

- timestamp: 2026-03-23T10:00:00.000Z
  checked: encodeWorkflowPath function behavior
  found: The function (line 177-182) adds `ps-workflows/` prefix to names that don't already have it when reading workflow files. This suggests the API might return names without this prefix, but the prefix is added when making API calls to read workflows.
  implication: There may be a mismatch: the workflow list might return names WITHOUT `ps-workflows/` prefix, but when storing workflow_name during prompt submission, the selectedWorkflow.name might have the prefix. Need to verify the actual format.

- timestamp: 2026-03-23T10:30:00.000Z
  checked: findBestMatchingWorkflow matching logic
  found: The previous matching logic didn't account for `ps-workflows/` prefix that might be present in workflow list names but not in stored workflow_name (or vice versa).
  action: Added `stripPsWorkflowsPrefix` helper function and enhanced logging with JSON.stringify to show RAW workflow names. Also added comparison of both raw and stripped names.
  implication: This should reveal if there's a prefix mismatch between the stored workflow_name and the workflow list names.

## Resolution

root_cause: (Under investigation - pending user testing with enhanced logging)
fix: Added `stripPsWorkflowsPrefix` helper to normalize both sides, and enhanced logging to show RAW workflow names
verification: Pending - needs user testing with enhanced logging
files_changed: [code/webapp/src/pages/Draw.tsx]
