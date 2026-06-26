# Debug Session: cluster-task-generation
- **Status**: [OPEN]
- **Issue**: 集群模式下最近修改后出现“无法生成任务”，需要确认是生成入口未触发、提交前置条件拦截、任务提交失败，还是任务列表刷新链路导致的异常表现。
- **Debug Server**: Pending
- **Log File**: .dbg/trae-debug-log-cluster-task-generation.ndjson

## Reproduction Steps
1. 打开插件并切换到集群模式。
2. 选择一个 ComfyUI 工作流模板。
3. 上传参考图片。
4. 点击生成，观察是否真正创建任务以及是否出现任务状态接口异常刷新。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 点击生成后没有真正进入 `handleClusterSubmit()`，问题发生在 `handleGenerate()` 或按钮状态上。 | High | Low | Pending |
| B | 已进入 `handleClusterSubmit()`，但被 `isLemonGridConnected`、`selectedTemplate`、图片数量等前置条件提前拦截。 | High | Low | Pending |
| C | `submitTask()` 已调用，但被服务端参数校验或鉴权失败拒绝，所以看起来像“无法生成”。 | High | Med | Pending |
| D | 任务其实已创建，但 `MiniTaskList`/轮询链路反复刷新状态，造成生成异常或重复请求表现。 | Med | Med | Pending |
| E | 我刚改的 `MiniTaskList` 轮询依赖导致组件重建/刷新时序异常，间接影响任务展示或后续状态判断。 | Med | Med | Pending |

## Log Evidence
- Pending

## Verification Conclusion
- Pending
