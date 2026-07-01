import { APIError } from 'openai'
import { createDeepSeekClient } from '../openaiClient'
import type { DeliveryWeatherBlock } from './types'

/**
 * 用 AI 结合 BOM 预报数据，生成面向快递末端派送的明天/后天天气播报文案。
 * 返回自然语言正文（不含标题）；未配置 DEEPSEEK_API_KEY 或调用失败时返回 null，
 * 由调用方回退到机械渲染（renderDeliveryWeatherLarkMd）。
 */
export async function generateDeliveryWeatherText(
  block: DeliveryWeatherBlock,
): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) return null

  const systemPrompt = [
    'You are a weather briefing assistant for last-mile delivery drivers in Australia. Write a short forecast for tomorrow and the day after, in ENGLISH.',
    'Goal: warn drivers about weather that hurts delivery efficiency or safety (rain, thunderstorms, hail, strong wind).',
    'Return RICH-TEXT MARKDOWN (feishu lark_md): use **bold** to highlight the key weather / risk. Keep formatting light — no headings, tables, or bullet lists.',
    'Input is JSON: locationLabel (place); days (each has dateLabel, impactLevel, impactLabel, rainChance in %, rainAmount, summary).',
    'Rules:',
    '① ONLY write about a day whose weather actually affects delivery (impactLevel severe / moderate / mild). Mention the day, the main weather with rain chance/amount, and a short reminder.',
    '② For the reminder, focus on keeping the shipping label from getting wet in the rain (a wet label becomes unscannable) and note that efficiency will drop — paraphrase NATURALLY in your own words. Do NOT reuse the same sentence, and do NOT make every day sound identical; vary wording, emphasis and emojis so it never feels templated.',
    '③ Be VERY short — roughly one brief line per affected day (aim for under ~20 words). No filler.',
    '④ SKIP any "normal" day (no adverse weather) — no line, no "good for delivery" filler.',
    '⑤ If BOTH days are normal, output a single short, friendly line saying the next two days look fine for delivery (phrase it freshly).',
    '⑥ A few emojis are fine (🌧️ ⛈️ 💨 ☀️). Use only the given data; do not invent numbers. Do NOT mention "AI", "model", or "auto-generated". Do NOT add an overall title (the system adds it).',
  ].join('\n')

  const userPrompt = ['Data (JSON):', JSON.stringify(block)].join('\n')

  try {
    const client = createDeepSeekClient(apiKey)
    const model = process.env.DEEPSEEK_WEATHER_MODEL?.trim() || 'deepseek-chat'
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })
    const text = (completion.choices[0]?.message?.content ?? '').trim()
    return text || null
  } catch (err) {
    const reason =
      err instanceof APIError
        ? [err.message, err.status ? `HTTP ${err.status}` : ''].filter(Boolean).join(' ')
        : err instanceof Error
          ? err.message
          : String(err)
    console.warn(`[weather/ai] 天气文案生成失败，回退机械渲染：${reason}`)
    return null
  }
}
