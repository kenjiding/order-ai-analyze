import { runOrderAnalyzeRegression } from './runRegression.js'

async function main(): Promise<void> {
  const aiProviderRaw = String(process.env.ORDER_ANALYZE_REGRESSION_PROVIDER ?? 'deepseek')
    .trim()
    .toLowerCase()
  const aiProvider = aiProviderRaw === 'openai' ? 'openai' : 'deepseek'

  const report = await runOrderAnalyzeRegression({ aiProvider })

  if (report.summary.total === 0) {
    console.log('[order-analyze-regression] 无 fixture 用例，跳过。请在页面录入或向 fixtures/ 添加 JSON。')
    return
  }

  console.log(
    `[order-analyze-regression] 完成: ${report.summary.passed}/${report.summary.total} 通过 (provider=${aiProvider})`
  )

  for (const c of report.cases) {
    const status = c.pass ? 'PASS' : 'FAIL'
    const sub = c.actual.exceptionCategoryId ? ` / ${c.actual.exceptionCategoryId}` : ''
    console.log(
      `  ${status} ${c.orderNo}: 期望 ${c.expected.lossScope}${c.expected.exceptionCategoryId ? ` / ${c.expected.exceptionCategoryId}` : ''} → 实际 ${c.actual.lossScope}${sub}`
    )
    if (!c.pass) {
      console.log(`         不匹配字段: ${c.mismatches.join(', ')}`)
      console.log(`         期望判定依据: ${c.expected.reason}`)
      console.log(`         实际判定依据: ${c.actual.reason}`)
    }
  }

  console.log(
    `  Token: prompt=${report.tokenUsage.promptTokens} completion=${report.tokenUsage.completionTokens} calls=${report.tokenUsage.apiCalls}`
  )

  if (report.summary.failed > 0) {
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error('[order-analyze-regression] 失败:', (e as Error).message)
  process.exitCode = 1
})
