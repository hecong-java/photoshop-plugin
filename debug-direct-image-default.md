# Debug Session: direct-image-default
- **Status**: [OPEN]
- **Issue**: 直连 ComfyUI 模式下选择 `FLUX2` 合并工作流后，上传图片再点击生成，`LoadImage` 节点仍提交工作流默认文件名 `未标题-2.jpg`，导致参数校验失败。
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-direct-image-default.ndjson

## Reproduction Steps
1. 在插件中进入直连 ComfyUI 模式。
2. 选择 `FLUX2` 合并工作流。
3. 上传 1 张参考图。
4. 点击生成，观察 `/prompt` 请求与 ComfyUI 返回错误。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 上传成功后 `latestInputValuesRef.current` 没写入 `image_76` 的最新文件名 | High | Low | Pending |
| B | 变体切换时 `remapInputValuesToWorkflowInputs()` 丢失图片字段 | High | Med | Pending |
| C | `compileWorkflowToPrompt()` 或 `enforceLatestImageInputs()` 没覆盖 `node 76.inputs.image` | High | Low | Pending |
| D | 上传接口返回值异常，但提交前没有把真实返回文件名带进最终 prompt | Med | Med | Pending |

## Log Evidence
- Pending

## Verification Conclusion
- Pending
