---
phase: quick-005
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - code/webapp/src/pages/History.tsx
autonomous: true
must_haves:
  truths:
    - "After clicking download button, file manager opens automatically"
    - "Download still completes successfully before file manager opens"
    - "File manager shows the downloads folder containing the saved file"
  artifacts:
    - path: "code/webapp/src/pages/History.tsx"
      provides: "Download handler with file manager trigger"
      contains: "openDownloadsFolder"
  key_links:
    - from: "History.tsx handleView"
      to: "download.ts openDownloadsFolder"
      via: "await after downloadAndSaveZip"
      pattern: "await openDownloadsFolder"
---

<objective>
Open system file manager automatically after download completes in History page.

Purpose: Improve user experience by automatically showing the downloaded file location.
Output: Modified History.tsx that opens file manager after successful download.
</objective>

<execution_context>
@C:/Users/Administrator/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/Administrator/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>

## Current Implementation

The download flow in History page:
1. User clicks "Download" button in HistoryItem.tsx
2. `handleDownload` calls `onView(item)` which maps to `handleView` in History.tsx
3. `handleView` calls `handleDownload` which:
   - Downloads images as zip via `downloadAndSaveZip`
   - Tracks the local download via `addLocalDownload`

The `openDownloadsFolder` function is already imported and used for a separate "Open Folder" button.

## Required Change

After `downloadAndSaveZip` completes successfully, call `openDownloadsFolder()` automatically.

</context>

<tasks>

<task type="auto">
  <name>Task 1: Add auto-open file manager after download</name>
  <files>code/webapp/src/pages/History.tsx</files>
  <action>
    Modify the `handleDownload` function in History.tsx to call `openDownloadsFolder()` after a successful download.

    Current code (lines 32-53):
    ```typescript
    const handleDownload = async (item: HistoryItem) => {
      if (!item.images || item.images.length === 0) {
        throw new Error('当前记录没有可下载图片');
      }

      const filename = generateDownloadFilename(item.imageName || 'comfyui', 0).replace(/\.png$/i, '.zip');
      const baseUrl = comfyUI.baseUrl;
      const client = new ComfyUIClient({ baseUrl });
      const urls = item.images.map((image, index) => ({
        url: client.getViewUrl({
          filename: image.filename,
          subfolder: image.subfolder || '',
          type: (image.type as 'output' | 'input' | 'temp') || 'output',
          preview: false,
        }),
        filename: image.filename,
        index,
      }));

      const result = await downloadAndSaveZip(urls, filename);
      addLocalDownload(item.promptId, result.savedPath);
    };
    ```

    Add `await openDownloadsFolder();` after `addLocalDownload`:
    ```typescript
    const result = await downloadAndSaveZip(urls, filename);
    addLocalDownload(item.promptId, result.savedPath);
    await openDownloadsFolder();  // <-- Add this line
    ```

    The `openDownloadsFolder` function is already imported at line 8.
  </action>
  <verify>
    <automated>grep -n "await openDownloadsFolder" code/webapp/src/pages/History.tsx</automated>
  </verify>
  <done>Download button triggers file manager to open after successful download</done>
</task>

</tasks>

<verification>
1. Verify the code change: grep finds `await openDownloadsFolder` in handleDownload function
2. Manual test: Click download in History page, file manager should open after zip is saved
</verification>

<success_criteria>
- File manager opens automatically after clicking download
- Download completes successfully before file manager opens
- No errors thrown during the process
</success_criteria>

<output>
After completion, create `.planning/quick/005-file-manager-download/005-SUMMARY.md`
</output>
