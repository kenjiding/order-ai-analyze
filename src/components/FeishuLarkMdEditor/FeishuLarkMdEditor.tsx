import { Color } from '@tiptap/extension-color'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle } from '@tiptap/extension-text-style'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Button, Input, Modal, Tooltip } from 'antd'
import {
  AtSign,
  Bold,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react'
import { editorContentFromStored } from './feishuEditorContent'
import { FeishuAtAll } from './feishuAtAllExtension'
import './feishuLarkMdEditor.css'

type Props = {
  value?: string
  onChange?: (value: string) => void
  rows?: number
  placeholder?: string
  disabled?: boolean
  id?: string
}

const COLOR_PRESETS: { label: string; color: string }[] = [
  { label: '红', color: 'red' },
  { label: '橙', color: 'orange' },
  { label: '绿', color: 'green' },
  { label: '蓝', color: 'blue' },
  { label: '灰', color: 'grey' },
]

const EDITOR_LINE_HEIGHT = 22
const EDITOR_PADDING_Y = 16

/** 上传/粘贴/拖拽插入图片的默认展示宽度（px），推送到飞书时按此宽度与自然比例换算尺寸 */
const DEFAULT_IMAGE_WIDTH = 300

/** 默认宽度 300px 的图片扩展：未显式指定宽度的图片（新粘贴/新插入）统一按 300px 展示 */
const SizedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: DEFAULT_IMAGE_WIDTH },
    }
  },
})

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('读取图片失败'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

/** 取剪贴板/拖拽数据里的图片文件 */
function pickImageFiles(list: FileList | null | undefined): File[] {
  if (!list) return []
  return Array.from(list).filter((f) => f.type.startsWith('image/'))
}

export function FeishuLarkMdEditor({
  value = '',
  onChange,
  rows = 4,
  placeholder,
  disabled,
  id,
}: Props) {
  const lastEmittedRef = useRef(value)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('https://')

  const minHeight = rows * EDITOR_LINE_HEIGHT + EDITOR_PADDING_Y

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        link: false,
      }),
      TextStyle,
      Color,
      SizedImage.configure({
        allowBase64: true,
        inline: false,
        resize: {
          enabled: true,
          directions: ['bottom-right', 'bottom-left', 'top-right', 'top-left'],
          minWidth: 80,
          minHeight: 80,
          alwaysPreserveAspectRatio: true,
        },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      }),
      Placeholder.configure({
        placeholder: placeholder ?? '输入推送内容…',
      }),
      FeishuAtAll,
    ],
    content: editorContentFromStored(value),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: 'feishu-lark-md-tiptap',
        ...(id ? { id } : {}),
      },
      // 粘贴截图：以默认 300px 宽度插入（SizedImage 的 width 默认值），保持编辑顺序
      handlePaste: (view, event) => {
        if (!view.editable) return false
        const files = pickImageFiles(event.clipboardData?.files)
        if (!files.length) return false
        void (async () => {
          for (const file of files) {
            try {
              const dataUrl = await readImageFileAsDataUrl(file)
              const node = view.state.schema.nodes.image?.create({ src: dataUrl, alt: file.name })
              if (node) view.dispatch(view.state.tr.replaceSelectionWith(node))
            } catch {
              /* ignore */
            }
          }
        })()
        return true
      },
      // 拖拽图片文件到编辑器：同样按默认宽度插入到落点位置
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !view.editable) return false
        const files = pickImageFiles(event.dataTransfer?.files)
        if (!files.length) return false
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void (async () => {
          let insertAt = pos ?? view.state.selection.to
          for (const file of files) {
            try {
              const dataUrl = await readImageFileAsDataUrl(file)
              const node = view.state.schema.nodes.image?.create({ src: dataUrl, alt: file.name })
              if (node) {
                const safePos = Math.min(insertAt, view.state.doc.content.size)
                view.dispatch(view.state.tr.insert(safePos, node))
                insertAt = safePos + node.nodeSize
              }
            } catch {
              /* ignore */
            }
          }
        })()
        return true
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML()
      lastEmittedRef.current = html
      onChange?.(html)
    },
  })

  useEffect(() => {
    if (!editor) return
    if (value === lastEmittedRef.current) return
    const currentHtml = editor.getHTML()
    if (currentHtml === value) {
      lastEmittedRef.current = value
      return
    }
    editor.commands.setContent(editorContentFromStored(value), { emitUpdate: false })
    lastEmittedRef.current = value
  }, [value, editor])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [disabled, editor])

  const handleToolbarMouseDown = (e: MouseEvent) => {
    e.preventDefault()
  }

  const openLinkModal = () => {
    if (!editor || disabled) return
    const previousUrl = (editor.getAttributes('link').href as string | undefined) ?? ''
    setLinkUrl(previousUrl || 'https://')
    setLinkModalOpen(true)
  }

  const applyLink = () => {
    if (!editor) return
    const url = linkUrl.trim()
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    } else {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    }
    setLinkModalOpen(false)
  }

  const applyColor = (color: string) => {
    if (!editor || disabled) return
    editor.chain().focus().setColor(color).run()
  }

  const insertAtAll = () => {
    if (!editor || disabled) return
    editor.chain().focus().insertFeishuAtAll().run()
  }

  const clearFormatting = () => {
    if (!editor || disabled) return
    editor.chain().focus().clearNodes().unsetAllMarks().run()
  }

  const toggleBold = () => {
    if (!editor || disabled) return
    const { from, to, empty } = editor.state.selection
    if (!empty) {
      const selected = editor.state.doc.textBetween(from, to)
      if (!selected.trim()) return
    }
    editor.chain().focus().toggleBold().run()
  }

  /**
   * 段内软换行（Shift+Enter / 粘贴产生的 <br>）会让列表把整段多行一起格式化。
   * 切列表前先把选区所在段落按软换行拆成独立段落，仅选中的行进入列表。
   */
  const splitHardBreaksInSelectedBlocks = () => {
    if (!editor) return
    const { state } = editor
    const { $from, $to } = state.selection
    const blockStart = $from.depth > 0 ? $from.start() : $from.pos
    const blockEnd = $to.depth > 0 ? $to.end() : $to.pos
    const breakPositions: number[] = []
    state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
      if (node.type.name === 'hardBreak') breakPositions.push(pos)
    })
    if (!breakPositions.length) return
    editor
      .chain()
      .command(({ tr }) => {
        // 倒序处理，前面的位置不受后面删除/拆分的影响
        for (const pos of breakPositions.sort((a, b) => b - a)) {
          tr.delete(pos, pos + 1)
          tr.split(pos)
        }
        return true
      })
      .run()
  }

  const toggleBulletList = () => {
    if (!editor || disabled) return
    splitHardBreaksInSelectedBlocks()
    editor.chain().focus().toggleBulletList().run()
  }

  const toggleOrderedList = () => {
    if (!editor || disabled) return
    splitHardBreaksInSelectedBlocks()
    editor.chain().focus().toggleOrderedList().run()
  }

  const openImagePicker = () => {
    if (disabled) return
    imageInputRef.current?.click()
  }

  const onImagePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !editor || disabled) return
    if (!file.type.startsWith('image/')) return
    try {
      const dataUrl = await readImageFileAsDataUrl(file)
      editor.chain().focus().setImage({ src: dataUrl, alt: file.name, width: DEFAULT_IMAGE_WIDTH }).run()
    } catch {
      /* ignore */
    }
  }

  if (!editor) {
    return (
      <div className="feishu-lark-md-editor">
        <div className="feishu-lark-md-editor-surface feishu-lark-md-editor-surface-loading" style={{ minHeight }} />
      </div>
    )
  }

  return (
    <div className="feishu-lark-md-editor">
      <div className="feishu-lark-md-editor-toolbar" role="toolbar" aria-label="富文本格式">
        <Tooltip title="撤销">
          <Button
            type="text"
            disabled={disabled || !editor.can().undo()}
            icon={<Undo2 className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={() => editor.chain().focus().undo().run()}
          />
        </Tooltip>
        <Tooltip title="重做">
          <Button
            type="text"
            disabled={disabled || !editor.can().redo()}
            icon={<Redo2 className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={() => editor.chain().focus().redo().run()}
          />
        </Tooltip>
        <span className="feishu-lark-md-editor-toolbar-divider" aria-hidden />
        <Tooltip title="加粗">
          <Button
            type="text"
            disabled={disabled}
            className={editor.isActive('bold') ? 'feishu-lark-md-editor-btn-active' : undefined}
            icon={<Bold className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={toggleBold}
          />
        </Tooltip>
        <Tooltip title="斜体">
          <Button
            type="text"
            disabled={disabled}
            className={editor.isActive('italic') ? 'feishu-lark-md-editor-btn-active' : undefined}
            icon={<Italic className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
        </Tooltip>
        <Tooltip title="删除线">
          <Button
            type="text"
            disabled={disabled}
            className={editor.isActive('strike') ? 'feishu-lark-md-editor-btn-active' : undefined}
            icon={<Strikethrough className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />
        </Tooltip>
        <Tooltip title="插入链接">
          <Button
            type="text"
            disabled={disabled}
            className={editor.isActive('link') ? 'feishu-lark-md-editor-btn-active' : undefined}
            icon={<Link2 className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={openLinkModal}
          />
        </Tooltip>
        <Tooltip title="插入图片">
          <Button
            type="text"
            disabled={disabled}
            icon={<ImageIcon className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={openImagePicker}
          />
        </Tooltip>
        <Tooltip title="无序列表">
          <Button
            type="text"
            disabled={disabled}
            className={editor.isActive('bulletList') ? 'feishu-lark-md-editor-btn-active' : undefined}
            icon={<List className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={toggleBulletList}
          />
        </Tooltip>
        <Tooltip title="有序列表">
          <Button
            type="text"
            disabled={disabled}
            className={editor.isActive('orderedList') ? 'feishu-lark-md-editor-btn-active' : undefined}
            icon={<ListOrdered className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={toggleOrderedList}
          />
        </Tooltip>
        <Tooltip title="引用">
          <Button
            type="text"
            disabled={disabled}
            className={editor.isActive('blockquote') ? 'feishu-lark-md-editor-btn-active' : undefined}
            icon={<Quote className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
        </Tooltip>
        <Tooltip title="分隔线">
          <Button
            type="text"
            disabled={disabled}
            icon={<Minus className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          />
        </Tooltip>
        <Tooltip title="@所有人">
          <Button
            type="text"
            disabled={disabled}
            icon={<AtSign className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={insertAtAll}
          />
        </Tooltip>
        <Tooltip title="清除格式">
          <Button
            type="text"
            disabled={disabled}
            icon={<RemoveFormatting className="h-4 w-4" />}
            onMouseDown={handleToolbarMouseDown}
            onClick={clearFormatting}
          />
        </Tooltip>
        <span className="feishu-lark-md-editor-toolbar-divider" aria-hidden />
        {COLOR_PRESETS.map(({ label, color }) => (
          <Tooltip key={color} title={`${label}色文字`}>
            <Button
              type="text"
              disabled={disabled}
              className={`feishu-lark-md-editor-color-btn feishu-lark-md-editor-color-${color}`}
              onMouseDown={handleToolbarMouseDown}
              onClick={() => applyColor(color)}
            >
              {label}
            </Button>
          </Tooltip>
        ))}
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void onImagePicked(e)}
      />

      <div
        className={`feishu-lark-md-editor-surface feishu-lark-md-editor-content${disabled ? ' feishu-lark-md-editor-content-disabled' : ''}`}
        style={{ minHeight }}
      >
        <EditorContent editor={editor} />
      </div>

      <div className="feishu-lark-md-editor-hint">
        分隔线、@所有人与图片按编辑顺序推送到飞书卡片。
      </div>

      <Modal
        title="插入链接"
        open={linkModalOpen}
        okText="确定"
        cancelText="取消"
        onOk={applyLink}
        onCancel={() => setLinkModalOpen(false)}
        destroyOnHidden
        focusable={{ focusTriggerAfterClose: false }}
      >
        <div className="space-y-2 pt-1">
          <div className="text-xs text-[var(--admin-muted)]">先选中文字再点链接按钮；未选中时将在光标处插入链接。</div>
          <Input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://"
            onPressEnter={applyLink}
          />
        </div>
      </Modal>
    </div>
  )
}
