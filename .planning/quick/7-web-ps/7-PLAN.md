---
phase: quick-7
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: false
requirements: []
user_setup:
  - service: webapp_server
    why: "Deploy updated webapp to server"
    human_action: "Build and deploy webapp to http://123.207.74.28:8080"
    verify_steps:
      - "Open http://123.207.74.28:8080 in browser"
      - "Check browser console for [Draw] Generated random seed logs"
      - "Verify seed appears only once per generation"

must_haves:
  truths:
    - "Random seed is displayed correctly in both web browser and PS plugin webview"
    - "Server at http://123.207.74.28:8080 serves the updated webapp code"
  artifacts:
    - path: "http://123.207.74.28:8080"
      provides: "Deployed webapp with random seed fix"
  key_links:
    - from: "PS plugin webview"
      to: "http://123.207.74.28:8080"
      via: "webview src attribute"
      pattern: "uxpEnableMessageBridge"
---

<objective>
Deploy the updated webapp (with random seed fix from quick-6) to the production server so the PS plugin webview shows correct random seeds.

Purpose: The random seed display fix was already applied to local code in quick-6, but the server at http://123.207.74.28:8080 needs to be updated.
Output: PS plugin webview correctly displays generated random seeds.
</objective>

<execution_context>
@C:/Users/Administrator/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/Administrator/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

## Problem Analysis

**Quick-6 Already Fixed The Code:**
- The random seed fix was applied to `code/webapp/src/pages/Draw.tsx` in quick-6
- The fix ensures `compileWorkflowToPrompt` does not overwrite pre-generated random seeds
- Local code now checks `inputs[widgetName] === undefined` before generating new seeds

**Root Cause:**
- The server at `http://123.207.74.28:8080` is serving OLD JavaScript
- PS plugin webview loads from this server URL (see index.html line 13)
- Browser may have been testing against local dev server, hence the difference

**Architecture Clarification:**
- Random seed is pure React state (`inputValues`) - NOT bridge communication
- The webview loads the same remote webapp code
- Once server is updated, both browser and PS plugin will work identically

## Verification

The fix is already in local code:
```bash
grep -n "inputs\[widgetName\] === undefined" code/webapp/src/pages/Draw.tsx
# Output:
# 1880:        if (resolvedValue !== undefined && inputs[widgetName] === undefined) {
# 1894:        if (isSeedInput && widgetValues[idx + 1] === 'randomize' && inputs[widgetName] === undefined) {
```

</context>

<tasks>

<task type="checkpoint:human-action">
  <name>Task 1: Build and deploy webapp to production server</name>
  <files>N/A - server deployment</files>
  <action>
    The code fix is already in place locally. You need to:

    1. **Build the webapp:**
       ```bash
       cd code/webapp
       npm run build
       ```

    2. **Deploy to server (http://123.207.74.28:8080):**
       - Use your standard deployment method (SSH, FTP, CI/CD, etc.)
       - Upload the contents of `code/webapp/dist/` to the server

    3. **Verify deployment:**
       - Open http://123.207.74.28:8080 in a browser
       - Open browser developer console (F12)
       - Select a workflow with randomize seed (e.g., "光影重绘")
       - Click generate
       - Verify console shows `[Draw] Generated random seed` only ONCE
       - Verify the seed value in UI matches console log
  </action>
  <verify>
    Manual verification required - check server is serving updated code
  </verify>
  <done>
    Server at http://123.207.74.28:8080 serves updated webapp with random seed fix.
    PS plugin webview displays correct random seeds.
  </done>
</task>

<task type="checkpoint:human-verify">
  <name>Task 2: Verify PS plugin shows correct random seeds</name>
  <files>N/A - verification only</files>
  <action>
    After deploying to server, verify the fix works in PS plugin:

    1. Open Photoshop with the plugin installed
    2. Open the plugin panel (柠乐AI工具)
    3. Select a workflow with randomize seed
    4. Click generate
    5. Verify the random seed is displayed in the UI
    6. Verify the seed value matches what was sent to ComfyUI
  </action>
  <verify>
    <automated>N/A - requires PS plugin interaction</automated>
  </verify>
  <done>
    PS plugin webview shows correct random seeds, matching the web browser behavior.
  </done>
</task>

</tasks>

<verification>
1. Server deployment complete
2. Browser at http://123.207.74.28:8080 shows correct random seed behavior
3. PS plugin webview shows correct random seed behavior
4. No bridge changes needed - this is pure React state
</verification>

<success_criteria>
- Webapp deployed to http://123.207.74.28:8080 with updated code
- PS plugin webview displays generated random seeds correctly
- Browser and PS plugin show identical behavior
</success_criteria>

<output>
After completion, create `.planning/quick/7-web-ps/7-SUMMARY.md`
</output>
