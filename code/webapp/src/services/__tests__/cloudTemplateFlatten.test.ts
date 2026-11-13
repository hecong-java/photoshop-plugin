import { describe, expect, it } from 'vitest';
import {
  flattenCloudTemplate,
  filterParamsForModel,
  isImageCloudTemplate,
  type LemonGridTemplateSummary,
} from '../lemongrid';

const mkTemplate = (
  overrides: Partial<LemonGridTemplateSummary> = {}
): LemonGridTemplateSummary => ({
  id: 't-series',
  name: 'GPT系列',
  description: '',
  category: 'api_mart',
  thumbnail_url: null,
  tags: [],
  version: 1,
  updated_at: '',
  template_type: 'THIRD_PARTY_API',
  param_schema: [
    {
      node_id: 'api',
      input_name: 'model',
      type: 'COMBO',
      label: '模型',
      default: 'gpt-image-2.6-flare',
      options: [
        { label: '2.6 官方版本-快速', value: 'gpt-image-2.6-flare' },
        { label: '2.6 官方版本-编辑', value: 'gpt-image-2.6-sunburst' },
        { label: '2.0 官方版本', value: 'gpt-image-2-official' },
      ],
    },
    { node_id: 'api', input_name: 'prompt', type: 'STRING', label: '提示词' },
    { node_id: 'api', input_name: 'aspect_ratio', type: 'COMBO', label: '宽高比', default: 'auto', options: ['auto', '1:1'] },
    // 只对 2.6 官方两版适用
    {
      node_id: 'api', input_name: 'moderation', type: 'COMBO', label: '审核强度',
      default: 'auto', options: ['auto'],
      applicable_models: ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'],
    },
    // 只对 2.0 官方适用（2.6 下必须隐藏，否则就是"重复参数"）
    {
      node_id: 'api', input_name: 'background', type: 'COMBO', label: '背景模式',
      default: 'auto', options: ['auto'],
      applicable_models: ['gpt-image-2-official'],
    },
    // 无标记 = 全版本适用
    { node_id: 'api', input_name: 'image_urls', type: 'IMAGEUPLOAD', label: '参考图片' },
  ],
  ...overrides,
});

describe('filterParamsForModel', () => {
  it('剔除 model 项与 applicable_models 不匹配的参数', () => {
    const schema = mkTemplate().param_schema as never[];
    const filtered = filterParamsForModel(schema, 'gpt-image-2.6-flare');

    const names = filtered.map((f) => f.name);
    expect(names).not.toContain('model');
    expect(names).not.toContain('background'); // 2.0 专属
    expect(names).toContain('prompt');
    expect(names).toContain('aspect_ratio');
    expect(names).toContain('moderation'); // 2.6 专属，命中
    expect(names).toContain('image_urls'); // 无标记，全适用
  });

  it('切到 2.0 官方版本时 2.6 专属参数被剔除', () => {
    const schema = mkTemplate().param_schema as never[];
    const filtered = filterParamsForModel(schema, 'gpt-image-2-official');

    const names = filtered.map((f) => f.name);
    expect(names).not.toContain('moderation');
    expect(names).toContain('background');
  });

  it('selectedModel 为空时仅剔除 model 项（保守全显示）', () => {
    const schema = mkTemplate().param_schema as never[];
    const filtered = filterParamsForModel(schema, undefined);

    expect(filtered.map((f) => f.name)).toEqual([
      'prompt', 'aspect_ratio', 'moderation', 'background', 'image_urls',
    ]);
  });

  it('applicable_models 缺省或空数组的参数全版本适用（向后兼容）', () => {
    const schema = [
      { node_id: 'api', input_name: 'a', type: 'STRING', label: 'A' },
      { node_id: 'api', input_name: 'b', type: 'STRING', label: 'B', applicable_models: [] },
    ];
    const filtered = filterParamsForModel(schema, 'whatever');
    expect(filtered).toHaveLength(2);
  });
});

describe('flattenCloudTemplate', () => {
  it('按 model options 展开成独立条目，条目名 = 系列名-版本 label', () => {
    const flat = flattenCloudTemplate(mkTemplate());

    expect(flat).toHaveLength(3);
    expect(flat[0].displayName).toBe('GPT系列 2.6 官方版本-快速');
    expect(flat[1].displayName).toBe('GPT系列 2.6 官方版本-编辑');
    expect(flat[2].displayName).toBe('GPT系列 2.0 官方版本');
    expect(flat[0].modelValue).toBe('gpt-image-2.6-flare');
    expect(flat[0].template).toBe(flat[1].template); // 同源模板
  });

  it('每个条目的 param_schema 已按版本过滤（无 model 项、无跨版本参数）', () => {
    const flat = flattenCloudTemplate(mkTemplate());
    const first = flat[0]; // 2.6-flare
    const names = first.param_schema.map((f) => f.name);

    expect(names).not.toContain('model');
    expect(names).not.toContain('background');
    expect(names).toContain('moderation');
  });

  it('无 model 字段或 options 为空的模板原样返回单条（名称不带后缀）', () => {
    const noModel = mkTemplate({
      id: 't-single',
      name: 'Sora 2',
      param_schema: [
        { node_id: 'api', input_name: 'prompt', type: 'STRING', label: '提示词' },
      ],
    });
    const flat = flattenCloudTemplate(noModel);

    expect(flat).toHaveLength(1);
    expect(flat[0].displayName).toBe('Sora 2');
    expect(flat[0].modelValue).toBeUndefined();
    expect(flat[0].param_schema.map((f) => f.name)).toEqual(['prompt']);
  });

  it('model 项的 default 即对应条目的提交模型值', () => {
    const flat = flattenCloudTemplate(mkTemplate());
    expect(flat[2].modelValue).toBe('gpt-image-2-official'); // 第三个 option 的 value
  });
});

describe('isImageCloudTemplate（PS 只接入图片生成模型）', () => {
  it('api_mart 分类是图片模型，保留', () => {
    expect(isImageCloudTemplate(mkTemplate({ category: 'api_mart' }))).toBe(true);
  });

  it('sp_api 分类是视频模型（Seedance/Sora/Kling 等），排除', () => {
    expect(isImageCloudTemplate(mkTemplate({ category: 'sp_api', name: 'Sora 2' }))).toBe(false);
  });

  it('sp_api 的"提示词增强"类模板同样排除（PS 场景用不到）', () => {
    expect(isImageCloudTemplate(mkTemplate({ category: 'sp_api', name: 'MiniMax H3 Context-IR 提示词增强' }))).toBe(false);
  });

  it('分类为空的模板保守保留（防新模板漏接）', () => {
    expect(isImageCloudTemplate(mkTemplate({ category: '' }))).toBe(true);
  });
});
