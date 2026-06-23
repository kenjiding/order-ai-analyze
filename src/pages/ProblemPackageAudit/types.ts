// ---------- 原始数据类型 ----------

export type DaCodeItem = {
  daCode: string
  ofdDate: string
  [key: string]: unknown
}

export type ProblemPackageListItem = {
  taskId: string
  waybillNo?: string
  dtlCode?: string
  problemType?: string
  problemReason?: string
  [key: string]: unknown
}

export type ProblemPackageDetail = {
  problemReasonDesc: string
  /** 派件员填写的补充描述 */
  problemRemark: string
  images: string[]
}

// ---------- AI 审核结果 ----------

export type ImageAuditResult = {
  index: number
  /** 图片左下角地址水印（坐标 + 具体地址），无则为空字符串 */
  address?: string
  /** AI 对图片内容的客观描述（CoT 中间步骤） */
  observation?: string
  imageType: string
  qualified: boolean
  reason: string
}

export type PackageAuditResult = {
  overallQualified: boolean
  imageResults: ImageAuditResult[]
  /** 结构性校验错误（如缺少快递面单、缺少地址图片），独立于单张图片合格判断 */
  validationErrors?: string[]
  model?: string
}

// ---------- 分析状态（每个问题件） ----------

export type PackageStatus =
  | 'pending'
  | 'loading_detail'
  | 'analyzing'
  | 'completed'
  | 'error'

export type PackageAuditEntry = {
  packageInfo: ProblemPackageListItem
  detail: ProblemPackageDetail | null
  auditResult: PackageAuditResult | null
  status: PackageStatus
  error?: string
}

// ---------- 分析状态（每个 daCode） ----------

export type DaCodeLoadStatus = 'idle' | 'loading' | 'loaded' | 'error'
export type DaCodeAnalysisStatus = 'idle' | 'running' | 'paused' | 'completed'

export type DaCodeAuditEntry = {
  daCodeItem: DaCodeItem
  loadStatus: DaCodeLoadStatus
  loadError?: string
  packages: PackageAuditEntry[]
  analysisStatus: DaCodeAnalysisStatus
  /** 下次分析从哪个 package 继续（resume 用） */
  resumeIndex: number
}

// ---------- 过滤参数 ----------

export type FilterState = {
  stationCode: string
  dateRange: [string, string] | null
}
