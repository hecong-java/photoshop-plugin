// DashScope API client for image-to-prompt reverse engineering
// Uses Alibaba Cloud's Qwen VL models via OpenAI-compatible endpoint

import { bridgeFetch } from './upload';

// Types

export interface DashScopeConfig {
  apiKey: string;
  model: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

// Constants

export const DASHSCOPE_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export const MAX_IMAGE_DIMENSION = 2048;

export const DASHSCOPE_MODELS = [
  { id: 'qwen-vl-max', name: 'Qwen VL Max', description: '最强视觉理解能力' },
  { id: 'qwen-vl-plus', name: 'Qwen VL Plus', description: '均衡性能与成本' },
  { id: 'qwen3-vl-plus', name: 'Qwen3 VL Plus', description: '最新一代 VL 模型' },
] as const;

export const DEFAULT_MODEL = 'qwen-vl-plus';

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'detailed',
    name: '详细描述',
    description: '全面描述图片内容、构图、色彩和风格',
    systemPrompt:
      '你是一个专业的图像描述专家。请用中文详细描述这张图片的内容，包括：主体内容、构图方式、色彩搭配、光影效果、艺术风格。输出格式为一段流畅的自然语言描述，不要使用标签或列表格式。',
  },
  {
    id: 'concise',
    name: '简洁描述',
    description: '用一两句话概括图片内容',
    systemPrompt:
      '请用中文简洁地描述这张图片的内容，用一到两句话概括最重要的视觉元素和整体氛围。',
  },
  {
    id: 'composition',
    name: '构图分析',
    description: '分析图片的构图和视觉层次',
    systemPrompt:
      '你是一个专业的摄影构图分析师。请用中文分析这张图片的构图方式、视觉层次、前景/背景关系、视觉引导线、以及拍摄角度。输出为自然语言描述。',
  },
  {
    id: 'style',
    name: '风格分析',
    description: '分析图片的艺术风格和视觉特征',
    systemPrompt:
      '你是一个专业的艺术风格分析师。请用中文分析这张图片的艺术风格、视觉特征、可能使用的创作技法、以及它让你联想到的艺术流派或艺术家风格。输出为自然语言描述。',
  },
];

// Image utilities

/**
 * Converts an HTMLImageElement to a base64 string.
 * - For data: URLs, extracts the base64 portion directly.
 * - For other URLs (blob:, http:), draws to canvas and exports as PNG.
 * - Resizes images larger than MAX_IMAGE_DIMENSION on the longest side.
 */
export async function imageElementToBase64(
  imgElement: HTMLImageElement
): Promise<string> {
  // If already a data URL, extract the base64 part directly
  if (imgElement.src.startsWith('data:')) {
    return imgElement.src.split(',')[1];
  }

  // For blob: or http: URLs, draw to canvas and export
  let { naturalWidth: width, naturalHeight: height } = imgElement;

  // Scale down if either dimension exceeds the max
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas 2D context');
  }

  ctx.drawImage(imgElement, 0, 0, width, height);

  try {
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.split(',')[1];
  } catch (err) {
    throw new Error(
      'Failed to extract image data. The image may be from a cross-origin source that does not allow canvas access.'
    );
  }
}

// API client

/**
 * Analyzes an image using DashScope's Qwen VL model and returns a text description.
 *
 * @param config - API key and model selection
 * @param imageBase64 - Base64-encoded image data (without data: prefix)
 * @param prompt - Text prompt to send with the image
 * @param mimeType - MIME type of the image (default: image/png)
 * @returns The generated text description
 */
export async function analyzeImage(
  config: DashScopeConfig,
  imageBase64: string,
  prompt: string,
  mimeType: string = 'image/png'
): Promise<string> {
  const response = await bridgeFetch(
    DASHSCOPE_BASE_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
      }),
    },
    60000
  );

  if (!response.ok) {
    const errorData = (await response.json()) as {
      error?: { message?: string };
    };
    // CRITICAL: Do NOT include config.apiKey in error message (security)
    // Sanitize the API error message in case the server echoes back the key
    const rawMessage =
      errorData.error?.message || `DashScope API error: ${response.status}`;
    const safeMessage = rawMessage.split(config.apiKey).join('***');
    throw new Error(safeMessage);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
}
