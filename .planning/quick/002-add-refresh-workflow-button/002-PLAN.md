---
phase: quick
plan: 002
type: execute
wave: 1
depends_on: []
files_modified:
  - code/webapp/src/pages/Draw.tsx
  - code/webapp/src/pages/Draw.css
autonomous: true
requirements: []
must_haves:
  truths:
    - "User can click a refresh button next to workflow selector"
    - "Refresh button re-fetches workflow list from ComfyUI"
    - "Refresh button shows loading state during fetch"
  artifacts:
    - path: "code/webapp/src/pages/Draw.tsx"
      provides: "Refresh button component with onClick handler"
      contains: "fetchWorkflows"
    - path: "code/webapp/src/pages/Draw.css"
      provides: "Refresh button styling"
      contains: ".workflow-refresh-btn"
  key_links:
    - from: "Draw.tsx refresh button"
      to: "fetchWorkflows()"
      via: "onClick"
      pattern: "onClick.*fetchWorkflows"
---

<objective>
Add a refresh button next to the workflow selector that allows users to manually re-fetch the workflow list from ComfyUI.

Purpose: Users need to refresh workflows when new workflows are added to ComfyUI without reloading the entire page.
Output: Refresh button in workflow selector section that triggers fetchWorkflows().
</objective>

<execution_context>
@C:/Users/Administrator/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/Administrator/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>

## Current State

The Draw.tsx page has:
- `fetchWorkflows()` function at line 725 that fetches workflow list from ComfyUI
- `isLoadingWorkflows` state for loading indicator
- Workflow selector UI in control panel section (around line 2829)
- Workflow picker trigger button with title/subtitle display

## Target Location

Add refresh button in the workflow selector section, next to the workflow picker trigger button (inside `.workflow-dropdown` div, after the trigger button).

</context>

<tasks>

<task type="auto">
  <name>Task 1: Add refresh button to workflow selector UI</name>
  <files>code/webapp/src/pages/Draw.tsx</files>
  <action>
    In the workflow selector section (around line 2839), inside the `.workflow-dropdown` div, add a refresh button after the workflow picker trigger button.

    The button should:
    - Be positioned next to (after) the `.workflow-picker-trigger` button
    - Have className `workflow-refresh-btn`
    - Show a refresh icon (use Unicode character `\21BB` or emoji `\uD83D\uDD04`)
    - Call `fetchWorkflows()` on click
    - Be disabled when `isLoadingWorkflows` is true
    - Have title attribute "刷新工作流列表" (Refresh workflow list)

    Example structure:
    ```jsx
    <div className="workflow-dropdown">
      <button ...existing trigger button... />
      <button
        type="button"
        className="workflow-refresh-btn"
        onClick={fetchWorkflows}
        disabled={isLoadingWorkflows}
        title="刷新工作流列表"
      >
        {isLoadingWorkflows ? '...' : '\u21BB'}
      </button>
    </div>
    ```
  </action>
  <verify>
    <automated>grep -n "workflow-refresh-btn" code/webapp/src/pages/Draw.tsx</automated>
  </verify>
  <done>Refresh button appears in workflow dropdown section with onClick handler calling fetchWorkflows</done>
</task>

<task type="auto">
  <name>Task 2: Add refresh button CSS styles</name>
  <files>code/webapp/src/pages/Draw.css</files>
  <action>
    Add CSS styles for the `.workflow-refresh-btn` class in Draw.css.

    The button should:
    - Match the existing dark theme styling
    - Have fixed width/height (e.g., 36px) to be square
    - Use circular border-radius
    - Have subtle hover effect (opacity or background change)
    - Show disabled state (reduced opacity, no pointer events)
    - Be flex-shrink: 0 to prevent squishing
    - Align vertically with the trigger button

    Add after existing `.workflow-picker-trigger` styles (search for this class in the CSS file).

    Example:
    ```css
    .workflow-refresh-btn {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.05);
      color: #a0aec0;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .workflow-refresh-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      color: #e0e0e0;
    }

    .workflow-refresh-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    ```
  </action>
  <verify>
    <automated>grep -n "workflow-refresh-btn" code/webapp/src/pages/Draw.css</automated>
  </verify>
  <done>Refresh button has consistent styling with the rest of the UI</done>
</task>

</tasks>

<verification>
Manual verification:
1. Open Draw page in the app
2. Verify refresh button appears next to workflow selector
3. Click refresh button and verify workflow list reloads
4. Verify loading state shows while fetching
</verification>

<success_criteria>
- Refresh button visible next to workflow selector
- Clicking button triggers fetchWorkflows()
- Button shows loading/disabled state during fetch
- Styling consistent with existing dark theme
</success_criteria>

<output>
After completion, create `.planning/quick/002-add-refresh-workflow-button/002-SUMMARY.md`
</output>
