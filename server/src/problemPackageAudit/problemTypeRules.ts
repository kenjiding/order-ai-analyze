/**
 * 问题类型审核规则注册表
 *
 * 新增问题类型只需在 PROBLEM_TYPE_RULES 数组中追加一条记录，
 * prompt 构建器会自动识别并应用对应规则。
 *
 * 字段说明：
 * - keywords:            匹配 problemReasonDesc 的关键词（不区分大小写）
 * - evidenceSummary:     该问题类型要求证据图片"证明什么"（一句话）
 * - qualifiedCriteria:   合格证据必须满足的要求（bulleted，用于 prompt）
 * - disqualifiedCriteria: 典型不合格情况（bulleted，用于 prompt）
 */

export type ProblemTypeRule = {
  /** 问题类型名称（用于展示和日志） */
  name: string
  /** 用于匹配 problemReasonDesc 的关键词列表 */
  keywords: string[]
  /** 一句话描述证据图片需要证明什么 */
  evidenceSummary: string
  /** 合格标准（列表，每条以 "- " 开头） */
  qualifiedCriteria: string[]
  /** 不合格典型情况（列表，每条以 "- " 开头） */
  disqualifiedCriteria: string[]
}

export const PROBLEM_TYPE_RULES: ProblemTypeRule[] = [
  {
    name: '店铺关门',
    keywords: ['店铺关门', '商铺关门', '关门', 'shop closed', 'store closed', 'closed'],
    evidenceSummary: '证明目标店铺在派送时确实处于关闭或停业状态',
    qualifiedCriteria: [
      'Google Maps 截图且截图中明确显示该店铺营业状态为"Closed"或"关门"',
      '店铺入口的卷帘门/拉闸门已完全关闭，且图片清晰',
      '店铺门上有清晰可读的"今日休息"、"Closed"、"暂停营业"等告示',
      '店铺门口黑暗、无人且门锁清晰可见',
    ],
    disqualifiedCriteria: [
      '仅拍摄店铺外观，无法判断是否营业（如大门敞开但无人）',
      '图片模糊或角度不对，无法确认店铺关闭状态',
      '拍摄的不是目标店铺，或拍摄地点与送货地址明显不符',
      'Google Maps 截图但未显示营业状态，或显示的是其他商铺',
    ],
  },
  {
    name: '无人在家',
    keywords: ['无人在家', '无人接收', '无人接听', '不在家', 'no one home', 'no answer', 'nobody home'],
    evidenceSummary: '证明派送时收件人不在家或多次拨打电话无人接听',
    qualifiedCriteria: [
      '手机通话记录截图：须同时显示 ①收件人电话号码 ②拨打时间（日期+时刻）③通话状态（未接/已接）',
      '若为多次拨打，截图需包含至少2次拨打记录',
      '住宅门口照片，显示已按门铃/敲门但无人应答迹象',
    ],
    disqualifiedCriteria: [
      '通话记录截图看不清电话号码',
      '截图仅显示一次拨打且时长为0秒，无法证明多次尝试',
      '截图无时间戳，无法确认派送当天尝试联系',
      '与收件地址无关的照片',
    ],
  },
  {
    name: '地址错误',
    keywords: ['地址错误', '地址不符', '地址有误', '找不到地址', '地址不存在', 'wrong address', 'address not found'],
    evidenceSummary: '证明面单地址与实际地点不符或地址根本不存在',
    qualifiedCriteria: [
      '门牌号照片且清晰显示实际门牌号，与面单地址明显不符',
      'Google Maps 截图显示该地址不存在或与目标收货地址不匹配',
      '街道/楼栋照片，照片中可见明确的地址信息且与面单地址矛盾',
    ],
    disqualifiedCriteria: [
      '仅拍摄街道，无法看出地址信息',
      '门牌号模糊，无法与面单地址对比',
      '拍摄内容与地址验证无关',
    ],
  },
  {
    name: '拒收',
    keywords: ['拒收', '客户拒收', '拒绝签收', 'refused', 'rejected', 'return'],
    evidenceSummary: '证明收件人明确拒绝签收包裹',
    qualifiedCriteria: [
      '与收件人对话的截图（如短信、聊天记录），其中收件人明确表示拒收',
      '电话通话记录截图，显示与收件人已联系并确认拒收',
    ],
    disqualifiedCriteria: [
      '无任何收件人拒收的直接证据',
      '截图内容看不清文字',
      '与拒收行为无关的照片',
    ],
  },
]

/** 兜底规则：当 problemReasonDesc 无法匹配任何已知类型时使用 */
export const FALLBACK_RULE: Pick<
  ProblemTypeRule,
  'evidenceSummary' | 'qualifiedCriteria' | 'disqualifiedCriteria'
> = {
  evidenceSummary: '证明上报的问题原因属实，无法完成派送',
  qualifiedCriteria: [
    '图片内容与上报的问题原因直接相关',
    '图片清晰完整，关键信息可读',
    '能客观体现无法完成派送的原因',
  ],
  disqualifiedCriteria: [
    '图片内容与问题原因无关',
    '图片模糊或关键区域遮挡',
    '无法从图片判断是否支撑问题件上报',
  ],
}

export function findRuleByReason(problemReasonDesc: string): ProblemTypeRule | null {
  if (!problemReasonDesc) return null
  const lower = problemReasonDesc.toLowerCase()
  return (
    PROBLEM_TYPE_RULES.find((rule) =>
      rule.keywords.some((kw) => lower.includes(kw.toLowerCase())),
    ) ?? null
  )
}
