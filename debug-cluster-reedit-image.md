# Debug Session: cluster-reedit-image [OPEN]

## Symptoms
- 集群模式历史“重新编辑”后，文案能恢复，图片未恢复到界面。
- 用户点击“生成”后，UXP Network 中没有新的请求出现。
- 历史任务数据中可见图片相关参数，例如 `76.upload: { asset_id: "6a03f4c5-0063-4bae-b757-875082427267" }`。

## Falsifiable Hypotheses
1. 历史恢复阶段只识别字符串图片值，没有识别 `{ asset_id }` 结构，导致图片状态未进入 `templateParams/templateImageInputs/templateUploadedImagePreviews`。
2. 图片字段虽然恢复进了 `templateParams`，但没有恢复进 `templateImageInputs`，导致提交前的图片数量统计为 0，从而在 `handleClusterSubmit` 中提前返回。
3. 重新编辑后选中的模板详情与历史任务实际模板字段不完全一致，导致图片字段 key 未对齐，恢复值被写到错误键名上。
4. 点击“生成”后已经进入集群提交分支，但因为本地校验/早退条件触发而直接 `return`，所以 UXP Network 看不到任何新请求。
5. 生成按钮事件没有进入 `handleGenerate -> handleClusterSubmit` 链路，问题发生在 UI 事件绑定或连接态判断前。

## Evidence Plan
- 在历史恢复入口记录：模板 ID、匹配到的模板、图片字段 keys、历史参数中的图片值形态。
- 在 `applyClusterHistoryTemplate` 记录：每个图片字段最终写入的 params / inputs / previews。
- 在 `handleGenerate` 与 `handleClusterSubmit` 入口记录：connectionMode、selectedTemplate、图片计数、早退原因。
- 在提交前记录：实际要发送的 `snapshotParams` 中的图片字段值。

## Status
- Instrumentation added and logs collected.

## Evidence Summary
- `cluster history action payload` 日志显示历史图片参数为对象结构，例如 `76.upload: { asset_id: "..." }`。
- `cluster history state restored` 日志显示这些值只进入了 `paramValue`，但 `imageInputValue` 为空、`previewValue` 缺失。
- 因此前端把历史图片恢复成了“有参数、无图片槽位状态”的半恢复状态。

## Confirmed / Rejected
- Confirmed H1: 历史恢复只识别字符串，未正确消费 `{ asset_id }` 对象。
- Confirmed H2: 图片未进入可计数状态，提交前会被当成 0 张图。
- Rejected H3: 现有证据未显示字段 key 错位，模板字段 key 与历史参数 key 是对齐的。
- Pending H4/H5: 修复后需要再次复现，看生成是否已进入提交链路。

## Fix Applied
- 为模板图片值新增对象型 `asset_id` 提取逻辑。
- 历史恢复阶段允许对象型资产值生成缩略图预览。
- 提交阶段允许对象型资产值参与图片计数与 `snapshotParams` 组包。
