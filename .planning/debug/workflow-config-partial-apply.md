---
status: awaiting_human_verify
trigger: "workflow-config-partial-apply"
created: 2026-04-23T00:00:00.000Z
updated: 2026-04-23T00:22:00.000Z
---

## Current Focus

hypothesis: CONFIRMED - The filteredInputGroups useMemo (line 2994) has stale closure over config state. Its dependency array is [inputGroups, shouldDisplayNode, getAllowedInputs], but shouldDisplayNode/getAllowedInputs are stable zustand function references that don't change when config updates. The config state read via get() inside these functions changes when loadConfig() completes, but useMemo doesn't know to recompute.
test: Add config to the useMemo dependency array
expecting: After fix, filteredInputGroups recomputes when config changes
next_action: Implement fix by reading config from useConfigStore and adding it to useMemo dependencies

## Symptoms

expected: All node parameters configured in node-config.json should be correctly applied when loading a workflow
actual: Some node parameters are correctly applied, others are not (showing default values)
errors: No obvious errors
reproduction: Load a workflow, observe whether node parameters match node-config.json configuration
started: User-reported issue, uncertain when it started

## Eliminated

- hypothesis: parseWorkflowInputs does not set classType for LoadImage/CLIPTextEncode
  evidence: Traced through code - classType is resolved for ALL inputs at line 1868-1878 via nodeId lookup in nodeClassTypeById map. LoadImage gets `image_${nodeId}` name, lastIndexOf('_') correctly extracts nodeId, maps to "LoadImage". Same for CLIPTextEncode -> "CLIPTextEncode".
  timestamp: 2026-04-23T00:07:00.000Z

- hypothesis: lastIndexOf('_') baseInputName extraction is wrong for multi-underscore names
  evidence: Tested with "max_shift_24" and "batch_size_10" - lastIndexOf correctly splits at the last underscore, giving baseInputName="max_shift"/"batch_size" and nodeId="24"/"10".
  timestamp: 2026-04-23T00:08:00.000Z

- hypothesis: Config file itself is malformed
  evidence: Config lists 8 node types with correct class_type values. validateConfig() correctly sanitizes. Tested simulation and filtering logic produces correct results.
  timestamp: 2026-04-23T00:09:00.000Z

## Evidence

- timestamp: 2026-04-23T00:01:00.000Z
  checked: node-config.json contents
  found: Config lists 8 node types: LoadImage, CLIPTextEncode, KIE_NanoBanana2_Image, KIE_NanoBananaPro_Image, KIE_Seedream45_Edit, ImagePadForOutpaint, RandomNoise, EmptyFlux2LatentImage. Only LoadImage and EmptyFlux2LatentImage have explicit inputs filters (["image"] and ["batch_size"]). The rest have no inputs array = show all inputs.
  implication: Config is straightforward. The issue is not in the config file itself.

- timestamp: 2026-04-23T00:02:00.000Z
  checked: parseWorkflowInputs function at lines 1259-1883 in Draw.tsx
  found: Input names are formatted as `${inputName}_${nodeId}`. The classType for each input is resolved at line 1868-1878 by extracting nodeId from the name via `lastIndexOf('_')` and looking up in `nodeClassTypeById` map. For LoadImage and CLIPTextEncode, inputs are created with `image_${nodeId}` and `text_${nodeId}` respectively - the nodeId extraction via `lastIndexOf('_')` would get the correct nodeId. The nodeClassTypeById map is built at line 1284 from `nodeData.comfyClass || nodeData.class_type || nodeData.type`.
  implication: The classType resolution appears correct for nodes that have their type info in the workflow JSON's `nodes` array (ComfyUI workflow format).

- timestamp: 2026-04-23T00:03:00.000Z
  checked: Workflow JSON structure (精修产品.json)
  found: ComfyUI workflow format uses a top-level `nodes` array where each node has `type` field (e.g., "LoadImage", "CLIPTextEncode"). The workflow also has `widgets_values` arrays. The `class_type` field is NOT present on nodes in this format - instead `type` is used. The code correctly falls back with `nodeData.comfyClass || nodeData.class_type || nodeData.type`.
  implication: The classType resolution should work for ComfyUI workflow format.

- timestamp: 2026-04-23T00:04:00.000Z
  checked: filteredInputGroups logic at lines 2959-2994
  found: The filtering uses `shouldDisplayNode(group.classType)` to show/hide groups and `getAllowedInputs(group.classType)` to filter inputs within groups. The base input name is extracted via `lastIndexOf('_')` on `item.name`. For the name format `${inputName}_${nodeId}`, this correctly splits at the last underscore.
  implication: The filtering logic appears correct for standard input names. But what if inputName itself contains underscores? That would cause incorrect baseInputName extraction.

- timestamp: 2026-04-23T00:05:00.000Z
  checked: configStore.ts shouldDisplayNode and getAllowedInputs
  found: shouldDisplayNode does exact string match (`node.class_type === classType`). getAllowedInputs does `node.inputs ?? null` - if a node has no inputs property, returns null (all inputs shown). The config's nodes without inputs array will show ALL their inputs. Only LoadImage (inputs: ["image"]) and EmptyFlux2LatentImage (inputs: ["batch_size"]) filter inputs.
  implication: For CLIPTextEncode which has NO inputs array in config, getAllowedInputs returns null, so ALL inputs are shown. This means CLIPTextEncode filtering works at the node level (show the node) but not at the input level (show all inputs).

- timestamp: 2026-04-23T00:06:00.000Z
  checked: How input names map to baseInputName extraction with lastIndexOf('_')
  found: CRITICAL FINDING - The filteredInputGroups filter at line 2981-2983 does `item.name.lastIndexOf('_')` to extract baseInputName. For inputName like "max_shift" (which contains an underscore), the generated name would be "max_shift_24". Using `lastIndexOf('_')` extracts "24" as nodeId and "max_shift" as baseInputName - correct. BUT what about "batch_size"? Generated name: "batch_size_10". lastIndexOf('_') -> splits at position 10, giving baseInputName="batch_size" and nodeId="10". That's correct.
  implication: The lastIndexOf approach handles multi-underscore input names correctly because nodeId is always after the LAST underscore.

- timestamp: 2026-04-23T00:10:00.000Z
  checked: filteredInputGroups useMemo dependency array at Draw.tsx line 2994
  found: ROOT CAUSE - The useMemo has dependencies [inputGroups, shouldDisplayNode, getAllowedInputs]. The shouldDisplayNode and getAllowedInputs functions are stable zustand store references (created once in the store factory). They use get() internally to read latest config state, but useMemo only checks reference equality of dependencies. When loadConfig() completes and updates config state, these function references DO NOT change, so useMemo returns its cached result without recomputing. The config state change is invisible to useMemo.
  implication: Config filtering is stale after any config state change. On first load with persisted config, it works because persist restores config before first render. But when loadConfig() updates config (or config changes between sessions), the filtered result never updates until inputGroups changes for an unrelated reason.

## Resolution

root_cause: The filteredInputGroups useMemo at Draw.tsx line 2994 has a stale dependency issue. Its dependency array [inputGroups, shouldDisplayNode, getAllowedInputs] does not include the config state. The shouldDisplayNode and getAllowedInputs functions are stable zustand store references that read config via get() internally, but useMemo only checks reference equality - it cannot detect that the data these functions will return has changed. When loadConfig() completes asynchronously and updates the config state, useMemo does not recompute, so the filtering result remains based on the previous (or null) config.
fix: Two changes in Draw.tsx - (1) Added `config` to the destructured values from `useConfigStore()` at line 234, making the config state a reactive dependency. (2) Added `config` to the `filteredInputGroups` useMemo dependency array at line 2994, changing it from `[inputGroups, shouldDisplayNode, getAllowedInputs]` to `[inputGroups, shouldDisplayNode, getAllowedInputs, config]`. Now when loadConfig() completes and updates config state, useMemo detects the change and recomputes the filtered groups.
verification: TypeScript compiles cleanly. configStore.test.ts passes (15/15). Pre-existing config.test.ts failure is unrelated (test passes JSON.stringify'd data but code expects parsed objects).
files_changed: [code/webapp/src/pages/Draw.tsx]
