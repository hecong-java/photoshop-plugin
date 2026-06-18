// Shared constants for workflow parsing and UI rendering.
// Extracted from Draw.tsx to avoid duplication between the Workflow Engine and the Draw page.

export const SKIPPED_NODE_TYPES = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode']);
export const DEFAULT_CLASS_TYPE = 'General';
export const ROOT_WORKFLOW_GROUP = '根目录';

export const NODE_TYPE_LABELS_ZH: Record<string, string> = {
  loadimage: '加载图片',
  saveimage: '保存图片',
  cliptextencode: '提示词编码',
  cliploader: 'CLIP 加载器',
  dualcliploader: '双 CLIP 加载器',
  unetloader: 'UNET 加载器',
  vaeloader: 'VAE 加载器',
  vaedecode: 'VAE 解码',
  vaeencode: 'VAE 编码',
  fluxguidance: 'Flux 引导',
  flux2scheduler: 'Flux 调度器',
  cfgguider: 'CFG 引导器',
  samplercustomadvanced: '高级采样器',
  ksampler: '采样器',
  ksamplerselect: '采样器选择',
  randomnoise: '随机噪声',
  getimagesize: '图像尺寸',
  emptyflux2latentimage: '空 Latent 图',
  referencelatent: '参考 Latent',
  conditioningzeroout: '条件清零',
  inpaintmodelconditioning: '局部重绘条件',
  layerutilityimagescalebyaspectratiov2: '按比例缩放',
  layermasksegmentanythingultrav2: '智能分割',
  growmaskwithblur: '蒙版扩展与模糊',
  kienanobanana2image: 'Nano Banana 2 图像',
  kienanobananaproimage: 'Nano Banana Pro 图像',
  kieseedream45edit: 'Seedream 4.5 编辑',
  sam2segment: 'SAM2 分割',
};

export const INPUT_NAME_LABELS_ZH: Record<string, string> = {
  image: '图片',
  images: '图片',
  upload: '上传',
  text: '文本',
  prompt: '提示词',
  aspectratio: '宽高比',
  resolution: '分辨率',
  outputformat: '输出格式',
  googlesearch: '联网搜索',
  log: '日志',
  seed: '随机种子',
  noiseseed: '噪声种子',
  steps: '步数',
  cfg: 'CFG',
  guidance: '引导强度',
  samplername: '采样器',
  scheduler: '调度器',
  denoise: '去噪强度',
  vaename: 'VAE 模型',
  unetname: 'UNET 模型',
  clipname: 'CLIP 模型',
  model: '模型',
  sammodel: 'SAM 模型',
  groundingdinomodel: 'GroundingDINO 模型',
};

export const normalizeNameKey = (value: string): string =>
  value.replace(/[^a-z0-9]/gi, '').toLowerCase();

export const containsChinese = (value: string): boolean =>
  /[㐀-鿿]/.test(value);

export const getNodeTypeChineseLabel = (nodeType: string): string | undefined =>
  NODE_TYPE_LABELS_ZH[normalizeNameKey(nodeType)];

export const getInputChineseLabel = (inputName: string): string | undefined =>
  INPUT_NAME_LABELS_ZH[normalizeNameKey(inputName)];
