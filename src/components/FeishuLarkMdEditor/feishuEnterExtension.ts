import { Extension } from '@tiptap/core'

/**
 * 回车语义按光标位置区分，保证「编辑器所见 = 飞书所得」：
 * - 行中回车（把一句话从中间断开）→ 软换行（<br>），飞书里就是紧挨的下一行；
 * - 行尾回车 → 空出一行（当前段落后插入一个空段落），飞书里空一行。
 *
 * 两者在推送侧本来都会变成段落分隔，渲染完全一样——用户在行尾敲回车看不出任何变化。
 * 列表 / 引用等结构里保留 TipTap 默认行为（回车 = 下一个列表项 / 退出结构）。
 */
export const FeishuEnterBehavior = Extension.create({
  name: 'feishuEnterBehavior',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty) return false
        if ($from.parent.type.name !== 'paragraph') return false
        if ($from.depth > 1) return false // 列表项 / 引用内的段落走默认行为

        const atEnd = $from.parentOffset === $from.parent.content.size
        if (!atEnd) return editor.commands.setHardBreak()

        // 行尾：拆出一个空段落再拆一次，光标落到空段落之后，中间那个空段落就是空行
        return editor.chain().splitBlock().splitBlock().run()
      },
    }
  },
})
