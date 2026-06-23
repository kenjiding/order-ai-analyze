import { useCallback, useRef, useState } from 'react'
import { useAppSettings } from '../../context/AppSettingsContext'
import { showToast } from '../../utils/toast'
import {
  aiAnalyzeProblemPackage,
  getProblemPackageDetail,
  searchFeedbackStatistics,
  searchProblemPackages,
} from './problemPackageAuditApi'
import type {
  DaCodeAuditEntry,
  DaCodeItem,
  FilterState,
  PackageAuditEntry,
  ProblemPackageListItem,
} from './types'

function makeIdleEntry(daCodeItem: DaCodeItem): DaCodeAuditEntry {
  return {
    daCodeItem,
    loadStatus: 'idle',
    packages: [],
    analysisStatus: 'idle',
    resumeIndex: 0,
  }
}

export function useProblemPackageAuditPage() {
  const { imileToken } = useAppSettings()

  // Search results
  const [daCodeItems, setDaCodeItems] = useState<DaCodeItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [lastFilter, setLastFilter] = useState<FilterState | null>(null)

  // Per-daCode audit state — kept in both ref (for async loops) and state (for renders)
  const auditMapRef = useRef<Record<string, DaCodeAuditEntry>>({})
  const [auditMap, _setAuditMap] = useState<Record<string, DaCodeAuditEntry>>({})

  // Which daCode is currently being actively analyzed
  const [activeDaCode, setActiveDaCode] = useState<string | null>(null)

  // Cooperative cancellation flag
  const pauseSignal = useRef(false)

  // Drawer
  const [drawerDaCode, setDrawerDaCode] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // ── Helper: sync ref → state ──────────────────────────────────────────────
  const syncAuditMap = useCallback(() => {
    _setAuditMap({ ...auditMapRef.current })
  }, [])

  function updateEntry(daCode: string, updater: (prev: DaCodeAuditEntry) => DaCodeAuditEntry) {
    const prev = auditMapRef.current[daCode]
    if (!prev) return
    auditMapRef.current = { ...auditMapRef.current, [daCode]: updater(prev) }
    _setAuditMap({ ...auditMapRef.current })
  }

  function updatePackage(
    daCode: string,
    index: number,
    updater: (prev: PackageAuditEntry) => PackageAuditEntry,
  ) {
    updateEntry(daCode, (entry) => {
      const packages = [...entry.packages]
      packages[index] = updater(packages[index])
      return { ...entry, packages }
    })
  }

  // ── Search (Step 1) ───────────────────────────────────────────────────────
  const handleSearch = useCallback(
    async (filter: FilterState) => {
      if (!imileToken) {
        showToast('请先在设置中配置 iMile Token', 'error')
        return
      }
      if (!filter.stationCode) {
        showToast('请填写站点代码', 'error')
        return
      }
      if (!filter.dateRange) {
        showToast('请选择日期范围', 'error')
        return
      }
      const [start, end] = filter.dateRange

      setSearchLoading(true)
      setLastFilter(filter)
      try {
        const res = await searchFeedbackStatistics({
          imileToken,
          start,
          end,
          stationCode: filter.stationCode,
        })
        setDaCodeItems(res.results)

        // Initialize audit entries for new daCode items
        const nextMap: Record<string, DaCodeAuditEntry> = {}
        for (const item of res.results) {
          nextMap[item.daCode] =
            auditMapRef.current[item.daCode] ?? makeIdleEntry(item)
        }
        auditMapRef.current = nextMap
        _setAuditMap({ ...nextMap })
      } catch (e) {
        showToast((e as Error).message || '查询失败', 'error')
      } finally {
        setSearchLoading(false)
      }
    },
    [imileToken],
  )

  // ── Analysis engine ───────────────────────────────────────────────────────

  /**
   * Load problem package list for a daCode (Step 2).
   * Called once per daCode; subsequent resumes skip this.
   */
  async function loadPackagesForDaCode(
    daCode: string,
    daCodeItem: DaCodeItem,
    filter: FilterState,
  ): Promise<ProblemPackageListItem[] | null> {
    const [start, end] = filter.dateRange!

    updateEntry(daCode, (e) => ({ ...e, loadStatus: 'loading' }))

    try {
      const res = await searchProblemPackages({
        imileToken,
        daCode,
        ofdDate: daCodeItem.ofdDate,
        stationCode: filter.stationCode,
        start,
        end,
      })

      const packages: PackageAuditEntry[] = res.results.map((info) => ({
        packageInfo: info,
        detail: null,
        auditResult: null,
        status: 'pending',
      }))

      updateEntry(daCode, (e) => ({
        ...e,
        loadStatus: 'loaded',
        packages,
        resumeIndex: 0,
      }))

      return res.results
    } catch (e) {
      updateEntry(daCode, (e_) => ({
        ...e_,
        loadStatus: 'error',
        loadError: (e as Error).message || '载入失败',
        analysisStatus: 'idle',
      }))
      return null
    }
  }

  /**
   * Main analysis loop for a single daCode.
   * Checks pauseSignal.current between each package.
   */
  async function runAnalysisLoop(daCode: string) {
    const entry = auditMapRef.current[daCode]
    if (!entry) return

    const packages = entry.packages
    const startIndex = entry.resumeIndex

    for (let i = startIndex; i < packages.length; i++) {
      // Check pause before each package
      if (pauseSignal.current) {
        updateEntry(daCode, (e) => ({
          ...e,
          analysisStatus: 'paused',
          resumeIndex: i,
        }))
        setActiveDaCode(null)
        return
      }

      const pkg = packages[i]

      // Skip already completed/errored
      if (pkg.status === 'completed' || pkg.status === 'error') continue

      // Step 3: Load detail
      updatePackage(daCode, i, (p) => ({ ...p, status: 'loading_detail' }))

      let detail: import('./types').ProblemPackageDetail | null = null
      try {
        detail = await getProblemPackageDetail(imileToken, pkg.packageInfo.taskId)
        updatePackage(daCode, i, (p) => ({ ...p, detail }))
      } catch (e) {
        updatePackage(daCode, i, (p) => ({
          ...p,
          status: 'error',
          error: (e as Error).message || '详情载入失败',
        }))
        // Update resumeIndex and continue next package
        updateEntry(daCode, (e_) => ({ ...e_, resumeIndex: i + 1 }))
        continue
      }

      // Check pause after detail load
      if (pauseSignal.current) {
        updateEntry(daCode, (e) => ({
          ...e,
          analysisStatus: 'paused',
          resumeIndex: i,
        }))
        setActiveDaCode(null)
        return
      }

      // Skip AI if no images
      if (!detail.images || detail.images.length === 0) {
        updatePackage(daCode, i, (p) => ({
          ...p,
          status: 'completed',
          auditResult: { overallQualified: true, imageResults: [] },
        }))
        updateEntry(daCode, (e) => ({ ...e, resumeIndex: i + 1 }))
        continue
      }

      // Step 4: AI analyze images
      updatePackage(daCode, i, (p) => ({ ...p, status: 'analyzing' }))

      try {
        const auditResult = await aiAnalyzeProblemPackage({
          imileToken,
          images: detail.images,
          problemReasonDesc: detail.problemReasonDesc,
          problemRemark: detail.problemRemark,
        })
        updatePackage(daCode, i, (p) => ({ ...p, status: 'completed', auditResult }))
      } catch (e) {
        updatePackage(daCode, i, (p) => ({
          ...p,
          status: 'error',
          error: (e as Error).message || 'AI 分析失败',
        }))
      }

      updateEntry(daCode, (e) => ({ ...e, resumeIndex: i + 1 }))
    }

    // All packages done
    if (!pauseSignal.current) {
      updateEntry(daCode, (e) => ({
        ...e,
        analysisStatus: 'completed',
        resumeIndex: 0,
      }))
      setActiveDaCode(null)
      showToast(`DA ${daCode} 分析完成`, 'success')
    }
  }

  /**
   * Start or resume analysis for a daCode.
   */
  const handleStartAnalysis = useCallback(
    async (daCodeItem: DaCodeItem) => {
      if (!imileToken) {
        showToast('请先在设置中配置 iMile Token', 'error')
        return
      }
      if (!lastFilter?.dateRange) {
        showToast('请先执行查询', 'error')
        return
      }

      const { daCode } = daCodeItem

      // Pause any in-progress analysis first
      pauseSignal.current = true
      // Give current loop a moment to see the signal before we reset
      await new Promise<void>((r) => setTimeout(r, 0))
      pauseSignal.current = false

      setActiveDaCode(daCode)

      // Ensure entry exists
      if (!auditMapRef.current[daCode]) {
        auditMapRef.current = {
          ...auditMapRef.current,
          [daCode]: makeIdleEntry(daCodeItem),
        }
        syncAuditMap()
      }

      const entry = auditMapRef.current[daCode]

      // Mark as running
      updateEntry(daCode, (e) => ({ ...e, analysisStatus: 'running' }))

      // Load packages if not yet loaded
      if (entry.loadStatus !== 'loaded') {
        const pkgList = await loadPackagesForDaCode(daCode, daCodeItem, lastFilter)
        if (!pkgList) {
          setActiveDaCode(null)
          return
        }
      }

      // Reset all pending packages if re-analyzing
      if (entry.analysisStatus === 'completed') {
        updateEntry(daCode, (e) => ({
          ...e,
          packages: e.packages.map((p) => ({
            ...p,
            status: 'pending',
            auditResult: null,
            detail: null,
          })),
          resumeIndex: 0,
          analysisStatus: 'running',
        }))
      }

      void runAnalysisLoop(daCode)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imileToken, lastFilter, syncAuditMap],
  )

  const handlePause = useCallback(() => {
    pauseSignal.current = true
    // Status will be updated by the loop when it sees the signal
  }, [])

  // ── Load packages without starting analysis (triggered from drawer) ──────
  const handleLoadPackages = useCallback(
    async (daCodeItem: DaCodeItem) => {
      if (!lastFilter?.dateRange) {
        showToast('请先执行查询', 'error')
        return
      }
      const { daCode } = daCodeItem
      if (!auditMapRef.current[daCode]) {
        auditMapRef.current = { ...auditMapRef.current, [daCode]: makeIdleEntry(daCodeItem) }
        syncAuditMap()
      }
      if (auditMapRef.current[daCode].loadStatus !== 'loaded') {
        await loadPackagesForDaCode(daCode, daCodeItem, lastFilter)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lastFilter, syncAuditMap],
  )

  // ── Single-package analysis (triggered from drawer) ───────────────────────
  const handleAnalyzeSinglePackage = useCallback(
    async (daCode: string, pkgIndex: number) => {
      if (!imileToken) {
        showToast('请先在设置中配置 iMile Token', 'error')
        return
      }

      const entry = auditMapRef.current[daCode]
      if (!entry) return
      const pkg = entry.packages[pkgIndex]
      if (!pkg) return

      // Already in-flight
      if (pkg.status === 'loading_detail' || pkg.status === 'analyzing') return

      let detail: import('./types').ProblemPackageDetail | null = pkg.detail

      // Load detail if not cached
      if (!detail) {
        updatePackage(daCode, pkgIndex, (p) => ({ ...p, status: 'loading_detail', error: undefined }))
        try {
          detail = await getProblemPackageDetail(imileToken, pkg.packageInfo.taskId)
          updatePackage(daCode, pkgIndex, (p) => ({ ...p, detail }))
        } catch (e) {
          updatePackage(daCode, pkgIndex, (p) => ({
            ...p,
            status: 'error',
            error: (e as Error).message || '详情载入失败',
          }))
          return
        }
      }

      // No images — mark complete immediately
      if (!detail.images || detail.images.length === 0) {
        updatePackage(daCode, pkgIndex, (p) => ({
          ...p,
          status: 'completed',
          auditResult: { overallQualified: true, imageResults: [] },
        }))
        return
      }

      // AI analyze
      updatePackage(daCode, pkgIndex, (p) => ({ ...p, status: 'analyzing' }))
      try {
        const auditResult = await aiAnalyzeProblemPackage({
          imileToken,
          images: detail.images,
          problemReasonDesc: detail.problemReasonDesc,
          problemRemark: detail.problemRemark,
        })
        updatePackage(daCode, pkgIndex, (p) => ({ ...p, status: 'completed', auditResult }))
      } catch (e) {
        updatePackage(daCode, pkgIndex, (p) => ({
          ...p,
          status: 'error',
          error: (e as Error).message || 'AI 分析失败',
        }))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imileToken],
  )

  // ── Drawer ────────────────────────────────────────────────────────────────
  const handleViewDetail = useCallback((daCode: string) => {
    setDrawerDaCode(daCode)
    setDrawerOpen(true)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
  }, [])

  return {
    daCodeItems,
    auditMap,
    searchLoading,
    activeDaCode,

    drawerOpen,
    drawerDaCode,

    handleSearch,
    handleStartAnalysis,
    handlePause,
    handleLoadPackages,
    handleAnalyzeSinglePackage,
    handleViewDetail,
    handleCloseDrawer,
  }
}
