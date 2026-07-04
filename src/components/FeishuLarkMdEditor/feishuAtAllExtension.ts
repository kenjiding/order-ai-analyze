import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    feishuAtAll: {
      insertFeishuAtAll: () => ReturnType
    }
  }
}

/** 飞书 lark_md @所有人 内联原子节点 */
export const FeishuAtAll = Node.create({
  name: 'feishuAtAll',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  parseHTML() {
    return [
      { tag: 'span.feishu-at-all' },
      { tag: 'span[data-feishu-at-all="true"]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'feishu-at-all',
        'data-feishu-at-all': 'true',
      }),
      '@所有人',
    ]
  },

  addCommands() {
    return {
      insertFeishuAtAll:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    }
  },
})
