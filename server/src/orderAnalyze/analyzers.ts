import { createDeepSeekClient, createOpenAIClient } from '../openaiClient'
import { deepSeekModelOmitsSamplingParams, readAnalyzeChunkSize, readAnalyzeConcurrency } from './config'
import { chunkTargets, mapWithConcurrency } from './runtime'
import { DEEPSEEK_JSON_INSTRUCTION, parseOrderAnalyzeResults, prepareAnalyzeCategories } from './prompt'
import type { OrderAnalyzeResult, AnalyzeTarget } from './types'
import { emptyTokenUsage, extractTokenUsage, mergeTokenUsage, type TokenUsage } from './usage'
import { AI_LOSS_SCOPE_VALUES } from './exceptionCatalog'

export async function analyzeOrdersWithOpenAi(input: {
  targets: AnalyzeTarget[]
}): Promise<{ results: OrderAnalyzeResult[]; tokenUsage: TokenUsage }> {
  const model = process.env.OPENAI_ORDER_MODEL ?? 'gpt-4.1-mini'
  const concurrency = readAnalyzeConcurrency()
  const chunkSize = readAnalyzeChunkSize()
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('服务端未配置 OPENAI_API_KEY')
  }

  const openai = createOpenAIClient(apiKey)
  const targetChunks = chunkTargets(input.targets, chunkSize)
  const chunkResults = await mapWithConcurrency(targetChunks, concurrency, async (targets) => {
    const analyzeInput = { targets }
    const { systemPromptBase, userPrompt } = prepareAnalyzeCategories(analyzeInput)
    const systemPrompt = `${systemPromptBase}\n输出必须是 JSON，对应 schema。`

    let chunkUsage = emptyTokenUsage()
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'order_exception_batch_analyze',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    orderNo: { type: 'string' },
                    lossScope: {
                      type: 'string',
                      enum: [...AI_LOSS_SCOPE_VALUES],
                    },
                    exceptionCategoryId: { type: 'string' },
                    reason: { type: 'string' },
                    confidence: { type: 'number' },
                  },
                  required: ['orderNo', 'lossScope', 'exceptionCategoryId', 'reason', 'confidence'],
                },
              },
            },
            required: ['results'],
          },
        },
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })

    chunkUsage = mergeTokenUsage(chunkUsage, extractTokenUsage(completion))
    const rawContent = completion.choices[0]?.message?.content ?? ''
    const results = parseOrderAnalyzeResults(rawContent, analyzeInput.targets)
    return { results, tokenUsage: chunkUsage }
  })
  const tokenUsage = chunkResults.reduce((acc, row) => mergeTokenUsage(acc, row.tokenUsage), emptyTokenUsage())
  return { results: chunkResults.flatMap((row) => row.results), tokenUsage }
}

export async function analyzeOrdersWithDeepSeek(input: {
  targets: AnalyzeTarget[]
}): Promise<{ results: OrderAnalyzeResult[]; tokenUsage: TokenUsage }> {
  const model = process.env.DEEPSEEK_ORDER_MODEL ?? 'deepseek-reasoner'
  const concurrency = readAnalyzeConcurrency()
  const chunkSize = readAnalyzeChunkSize()
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('服务端未配置 DEEPSEEK_API_KEY')
  }

  const client = createDeepSeekClient(apiKey)
  const targetChunks = chunkTargets(input.targets, chunkSize)
  const chunkResults = await mapWithConcurrency(targetChunks, concurrency, async (targets) => {
    const analyzeInput = { targets }
    const { systemPromptBase, userPrompt } = prepareAnalyzeCategories(analyzeInput)
    const systemPrompt = `${systemPromptBase}${DEEPSEEK_JSON_INSTRUCTION}`
    console.log('systemPrompt---->〉', systemPrompt)
    console.log('userPrompt----->〉', userPrompt)
    let chunkUsage = emptyTokenUsage()
    const completion = await client.chat.completions.create({
      model,
      ...(!deepSeekModelOmitsSamplingParams(model) ? { temperature: 0.1 as const } : {}),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })

    chunkUsage = mergeTokenUsage(chunkUsage, extractTokenUsage(completion))
    const rawContent = completion.choices[0]?.message?.content ?? ''
    const results = parseOrderAnalyzeResults(rawContent, analyzeInput.targets)
    return { results, tokenUsage: chunkUsage }
  })
  const tokenUsage = chunkResults.reduce((acc, row) => mergeTokenUsage(acc, row.tokenUsage), emptyTokenUsage())
  return { results: chunkResults.flatMap((row) => row.results), tokenUsage }
}
