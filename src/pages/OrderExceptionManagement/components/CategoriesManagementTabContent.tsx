import { Button, Input, Select } from 'antd'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConcreteLossScope, ExceptionCategoryEntity, LossScope } from '../types'
import { concreteLossScopeOptions, editLossScopeOptions } from '../orderExceptionDomain'

type CategoryEditPatch = {
  name?: string
  description?: string
  lossScope?: LossScope
}

type Props = {
  categories: ExceptionCategoryEntity[]
  sampleCountByCategoryId: Record<string, number>
  hasRepo: boolean
  newCategoryName: string
  onNewCategoryNameChange: (v: string) => void
  newCategoryDescription: string
  onNewCategoryDescriptionChange: (v: string) => void
  newCategoryLossScope: ConcreteLossScope
  onNewCategoryLossScopeChange: (v: ConcreteLossScope) => void
  onCreateCategory: () => void
  onUpdateCategory: (id: string, patch: CategoryEditPatch) => Promise<boolean>
  onDeleteCategory: (id: string) => void | Promise<void>
}

export function CategoriesManagementTabContent({
  categories,
  sampleCountByCategoryId,
  hasRepo,
  newCategoryName,
  onNewCategoryNameChange,
  newCategoryDescription,
  onNewCategoryDescriptionChange,
  newCategoryLossScope,
  onNewCategoryLossScopeChange,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
}: Props) {
  const { t, i18n } = useTranslation('orderException')
  const { t: tc } = useTranslation('common')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftLossScope, setDraftLossScope] = useState<LossScope>('库内丢失')
  const [saving, setSaving] = useState(false)

  const editBaselineRef = useRef<{
    name: string
    description: string
    lossScope: LossScope
  } | null>(null)

  const newLossScopeOptions = useMemo(() => concreteLossScopeOptions(t), [t])

  const editScopeOptions = useMemo(
    () => editLossScopeOptions(t, draftLossScope),
    [draftLossScope, t],
  )

  useEffect(() => {
    if (editingId && !categories.some((c) => c.id === editingId)) {
      setEditingId(null)
      editBaselineRef.current = null
    }
  }, [categories, editingId])

  function startEdit(c: ExceptionCategoryEntity) {
    setEditingId(c.id)
    setDraftName(c.name)
    setDraftDescription(c.description)
    setDraftLossScope(c.lossScope)
    editBaselineRef.current = {
      name: c.name.trim(),
      description: c.description.trim(),
      lossScope: c.lossScope,
    }
  }

  function cancelEdit() {
    setEditingId(null)
    editBaselineRef.current = null
  }

  async function saveEdit() {
    if (!editingId) return
    const targetId = editingId
    const base = editBaselineRef.current
    const trimmedName = draftName.trim()
    const trimmedDesc = draftDescription.trim()
    const patch: CategoryEditPatch = {}
    if (base) {
      if (trimmedName !== base.name) patch.name = trimmedName
      if (trimmedDesc !== base.description) patch.description = trimmedDesc
      if (draftLossScope !== base.lossScope) patch.lossScope = draftLossScope
    } else {
      patch.name = trimmedName
      patch.description = trimmedDesc
      patch.lossScope = draftLossScope
    }
    if (Object.keys(patch).length === 0) {
      cancelEdit()
      return
    }
    setSaving(true)
    try {
      const ok = await onUpdateCategory(targetId, patch)
      if (ok) {
        setEditingId((cur) => {
          if (cur === targetId) {
            editBaselineRef.current = null
            return null
          }
          return cur
        })
      }
    } finally {
      setSaving(false)
    }
  }

  if (!hasRepo) {
    return (
      <section className="admin-panel p-5">
        <p className="text-sm text-slate-600">{t('categories.noIdb')}</p>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      <section className="admin-panel p-5">
        <h3 className="text-sm font-semibold text-slate-950">{t('categories.createTitle')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('categories.createDescription')}</p>
        <div className="mt-4 space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-medium text-slate-600">{t('categories.categoryName')}</div>
                <Input
                  value={newCategoryName}
                  onChange={(e) => onNewCategoryNameChange(e.target.value)}
                  placeholder={t('categories.categoryNamePlaceholder')}
                  allowClear
                />
              </div>
              <div className="w-full shrink-0 sm:w-[200px]">
                <div className="mb-1 text-xs font-medium text-slate-600">{t('categories.lossType')}</div>
                <Select<ConcreteLossScope>
                  className="w-full"
                  value={newCategoryLossScope}
                  onChange={(v) => onNewCategoryLossScopeChange(v)}
                  options={newLossScopeOptions}
                />
              </div>
            </div>
            <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={onCreateCategory}>
              {t('categories.createCategory')}
            </Button>
          </div>
          <p className="text-xs text-slate-400">{t('categories.lossTypeHint')}</p>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">{t('categories.descriptionOptional')}</div>
            <Input.TextArea
              value={newCategoryDescription}
              onChange={(e) => onNewCategoryDescriptionChange(e.target.value)}
              rows={3}
              placeholder={t('categories.descriptionPlaceholder')}
            />
          </div>
        </div>
      </section>

      <section className="admin-panel p-5">
        <h3 className="text-sm font-semibold text-slate-950">{t('categories.manageTitle')}</h3>
        <p className="mt-1 text-xs text-slate-500">{t('categories.manageDescription')}</p>

        {!categories.length ? (
          <p className="mt-4 text-sm text-slate-500">{t('categories.empty')}</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {categories.map((c) => {
              const isEditing = editingId === c.id
              const samples = sampleCountByCategoryId[c.id] ?? 0
              return (
                <li key={c.id} className="px-4 py-4 first:rounded-t-lg last:rounded-b-lg sm:px-5">
                  {isEditing ? (
                    <div key={c.id} className="space-y-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 text-xs font-medium text-slate-600">{t('categories.categoryName')}</div>
                          <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                        </div>
                        <div className="w-full shrink-0 sm:w-[200px]">
                          <div className="mb-1 text-xs font-medium text-slate-600">{t('categories.lossType')}</div>
                          <Select<LossScope>
                            className="w-full"
                            value={draftLossScope}
                            onChange={(v) => setDraftLossScope(v)}
                            options={editScopeOptions}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-slate-600">{t('categories.descriptionOptional')}</div>
                        <Input.TextArea
                          value={draftDescription}
                          onChange={(e) => setDraftDescription(e.target.value)}
                          rows={3}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="primary"
                          loading={saving}
                          disabled={saving}
                          onClick={() => void saveEdit()}
                        >
                          {tc('save')}
                        </Button>
                        <Button disabled={saving} onClick={cancelEdit}>
                          {tc('cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium text-slate-950">{c.name}</span>
                          <span className="text-xs text-slate-500">· {c.lossScope}</span>
                        </div>
                        {c.description ? (
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                            {c.description}
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-slate-400">{t('categories.noDescription')}</p>
                        )}
                        <div className="mt-2 text-xs text-slate-500">
                          {t('categories.sampleCount', {
                            count: samples,
                            date: new Date(c.updatedAt).toLocaleString(i18n.language),
                          })}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 sm:pt-0">
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          className="admin-btn inline-flex items-center gap-2 border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                          {tc('edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteCategory(c.id)}
                          className="admin-btn inline-flex items-center gap-2 border border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                          {tc('delete')}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
