import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cascader } from 'antd'
import { fetchZktDepartments } from '../../api/zktAttendanceApi'
import {
  buildDepartmentCascaderOptions,
  cascaderPathsToDepartmentIds,
  departmentIdsToCascaderPaths,
  expandDepartmentIdsToLeaves,
  formatDepartmentIds,
  parseDepartmentIds,
  type ZktDepartmentNode,
} from '../../imile/zktDepartmentTree'

type Props = {
  username: string
  password: string
  value: string
  onChange: (departmentId: string) => void
}

export function ZktDepartmentCascader({ username, password, value, onChange }: Props) {
  const [nodes, setNodes] = useState<ZktDepartmentNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastFetchKeyRef = useRef('')

  const canFetch = Boolean(username.trim() && password)

  const loadDepartments = useCallback(async () => {
    if (!canFetch) {
      setNodes([])
      setError(null)
      return
    }

    const fetchKey = `${username.trim()}\0${password}`
    if (fetchKey === lastFetchKeyRef.current && nodes.length > 0) return

    setLoading(true)
    setError(null)
    try {
      const departments = await fetchZktDepartments({ username: username.trim(), password })
      lastFetchKeyRef.current = fetchKey
      setNodes(departments)
    } catch (e) {
      lastFetchKeyRef.current = ''
      setNodes([])
      setError((e as Error).message || '部门列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [canFetch, username, password, nodes.length])

  useEffect(() => {
    lastFetchKeyRef.current = ''
    setNodes([])
    setError(null)
  }, [username, password])

  useEffect(() => {
    void loadDepartments()
  }, [loadDepartments])

  const options = useMemo(() => buildDepartmentCascaderOptions(nodes), [nodes])

  const leafDepartmentIds = useMemo(
    () => formatDepartmentIds(expandDepartmentIdsToLeaves(parseDepartmentIds(value), nodes)),
    [value, nodes],
  )

  const cascaderValue = useMemo(
    () => departmentIdsToCascaderPaths(parseDepartmentIds(leafDepartmentIds), nodes),
    [leafDepartmentIds, nodes],
  )

  const lastMigratedValueRef = useRef<string | null>(null)

  useEffect(() => {
    if (!nodes.length || !value) return
    if (lastMigratedValueRef.current === value) return

    const normalized = formatDepartmentIds(parseDepartmentIds(value))
    const expanded = formatDepartmentIds(expandDepartmentIdsToLeaves(parseDepartmentIds(value), nodes))
    lastMigratedValueRef.current = value

    if (expanded !== normalized) {
      onChange(expanded)
    }
  }, [value, nodes, onChange])

  return (
    <div>
      <Cascader
        multiple
        options={options}
        value={cascaderValue}
        onChange={(paths) => {
          const rawIds = parseDepartmentIds(cascaderPathsToDepartmentIds(paths))
          onChange(formatDepartmentIds(expandDepartmentIdsToLeaves(rawIds, nodes)))
        }}
        placeholder={canFetch ? '请选择部门（可多选）' : '请先填写 ZKT 账号和密码'}
        disabled={!canFetch}
        loading={loading}
        allowClear
        expandTrigger="hover"
        maxTagCount="responsive"
        showSearch={{
          filter: (input, path) =>
            path.some((option) => String(option.label ?? '').toLowerCase().includes(input.toLowerCase())),
        }}
        style={{ width: '100%' }}
        className="mt-1.5"
      />
      {error ? <p className="mt-1.5 text-xs text-red-600">{error}</p> : null}
      {!error && leafDepartmentIds ? (
        <p className="mt-1.5 font-mono text-xs text-slate-500">departments={leafDepartmentIds}</p>
      ) : null}
    </div>
  )
}
