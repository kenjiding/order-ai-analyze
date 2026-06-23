import { FALLBACK_RULE, findRuleByReason } from './problemTypeRules'

function bulletList(items: string[]): string {
  return items.map((item) => `  • ${item}`).join('\n')
}

/**
 * 构建问题件图片审核的 AI Prompt。
 *
 * 设计原则（高准确率）：
 * 1. Chain-of-Thought：先要求 AI 用 observation 字段描述所见，再基于所见判断
 * 2. 分层审核：面单图片与证据图片使用完全独立的审核标准
 * 3. 动态规则：根据 problemReasonDesc 匹配对应规则，找不到时用兜底规则
 * 4. 负样本锚定：同时给出"合格"和"不合格"的典型情况，减少模型幻觉
 * 5. 严格 JSON schema：observation → imageType → qualified → reason，强制推理链
 */
export function buildAuditPrompt(params: {
  problemReasonDesc: string
  problemRemark: string
  imageCount: number
}): string {
  const { problemReasonDesc, problemRemark, imageCount } = params

  const rule = findRuleByReason(problemReasonDesc)
  const evidenceSummary = rule?.evidenceSummary ?? FALLBACK_RULE.evidenceSummary
  const qualifiedCriteria = rule?.qualifiedCriteria ?? FALLBACK_RULE.qualifiedCriteria
  const disqualifiedCriteria = rule?.disqualifiedCriteria ?? FALLBACK_RULE.disqualifiedCriteria
  const matchedTypeName = rule?.name ?? '未知类型'

  return `你是专业快递问题件图片审核员。请严格依据审核标准对图片逐一判断，不可猜测或假设图片未显示的内容。

## 问题件背景
- 系统问题类型：${problemReasonDesc || '未填写'}（识别为：${matchedTypeName}）
- 派件员补充描述：${problemRemark || '（无）'}

## 待审核图片
以下共 ${imageCount} 张图片，按顺序编号为图片0、图片1……

---

## 步骤 0 — 提取图片左下角地址水印

部分图片在**左下角**有地址水印，通常格式为：
  GPS 坐标（如 3.117380,101.670345）+ 具体街道/地址文字，共一至两行，最后一行为完整地址。

对每张图片：
- 仔细查看左下角是否有此类文字
- 若存在，将**最后一行**（坐标 + 地址）的原文完整填入 "address" 字段
- 若不存在或无法辨认，"address" 填空字符串 ""

---

## 审核标准 A — 快递面单（waybill）

**识别方式**：图片中存在快递运单/面单（印有条形码、发件人、收件人信息的标签或单据）。

**必须同时满足以下三点，缺一即为不合格**：

① **条形码**：面单上必须有可见的条形码（barcode），且清晰未被遮挡
② **订单号文字**：条形码附近必须有可读取的订单号（数字/字母串）
③ **收货地址**："To" 字段右侧的收货地址必须清晰完整，无模糊、遮挡或截断

不合格时，在 reason 中明确指出是哪一项不满足（如"条形码模糊"、"To地址被遮挡"）。

---

## 审核标准 B — 证据图片（非面单）

**目的**：${evidenceSummary}

**合格标准（满足其中一项即可）**：
${bulletList(qualifiedCriteria)}

**典型不合格情况**：
${bulletList(disqualifiedCriteria)}

---

## 审核标准 C — 其他类型图片

若图片既不是面单，也不是针对上述问题的证据，判断该图片内容是否能辅助支撑问题件上报。

---

## 输出格式

严格返回以下 JSON（不加任何解释、markdown 或代码块）：

{
  "results": [
    {
      "index": 0,
      "address": "（图片左下角最后一行地址水印原文，如无则填 ""）",
      "observation": "（描述图片中实际可见的内容，3-5句）",
      "imageType": "快递面单 | 电话记录截图 | 门牌号 | 店铺照片 | Google Maps截图 | 包裹存放位置 | 其他",
      "qualified": true,
      "reason": "（合格时留空字符串；不合格时说明具体原因）"
    }
  ]
}`
}
