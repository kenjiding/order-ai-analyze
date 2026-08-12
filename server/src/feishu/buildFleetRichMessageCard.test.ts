import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFleetRichMessageCard } from './buildFleetRichMessageCard'
import { FEISHU_BLOCK_MARKER, FEISHU_HR_MARKER } from './feishuLarkMdMarkers'

type Element = { tag: string; content?: string; margin?: string; img_key?: string; behaviors?: unknown[] }

function elementsOf(content: string, imageKeys: string[] = []): Element[] {
  const card = buildFleetRichMessageCard({ content, imageKeys }) as {
    body: { elements: Element[] }
  }
  return card.body.elements
}

/** 编辑器块序列 → 推送正文（块之间是标记，不是换行） */
function blocks(...list: string[]): string {
  return list.join(FEISHU_BLOCK_MARKER)
}

test('列表后面的段落独占一个元素，不会被 markdown 惰性延续行吞进最后一个列表项', () => {
  const els = elementsOf(
    blocks('For example:', '- F Zone\n- A Zone', '', '2️⃣ Violation Policy', 'Each driver will be given 3 warnings.'),
  )
  const list = els.find((e) => e.content?.startsWith('- F Zone'))
  assert.ok(list, '列表应当独立成一个 markdown 元素')
  assert.equal(list.content, '- F Zone\n- A Zone', '列表元素里不能混入后面的段落，否则飞书会把它当成同一个列表项')
  const after = els.find((e) => e.content?.startsWith('2️⃣'))
  assert.ok(after, '列表后的段落应当独立成元素')
  assert.ok(!after.content?.includes('- '), '列表语法不能和后续段落同处一个元素')
})

test('编辑器里的空行翻译成下一个元素的上外边距（列表后的空行不再消失）', () => {
  const els = elementsOf(blocks('- F Zone', '', '2️⃣ Violation Policy'))
  const after = els.find((e) => e.content?.startsWith('2️⃣'))
  assert.equal(after?.margin, '22px 0px 0px 0px', '一个空行 = 一行高度的上外边距')
})

test('列表后没有空行时紧贴渲染，和编辑器里敲一次回车一致', () => {
  const els = elementsOf(blocks('- F Zone', '2️⃣ Violation Policy'))
  const after = els.find((e) => e.content?.startsWith('2️⃣'))
  assert.equal(after?.margin, undefined, '没有空行就不该有额外间距')
})

test('连续多个空行按行数累加，且不超过 margin 上限', () => {
  assert.equal(elementsOf(blocks('a', '', '', 'b')).at(-1)?.margin, '44px 0px 0px 0px')
  assert.equal(elementsOf(blocks('a', '', '', '', '', '', '', 'b')).at(-1)?.margin, '88px 0px 0px 0px')
})

test('连续纯文本块合并进一个元素（段内 \\n 就是 <br>），元素数不随回车次数膨胀', () => {
  const els = elementsOf(blocks('📢 Trolley Return Procedure Update', 'Dear Suppliers,', 'To ensure smooth operations'))
  assert.equal(els.length, 1)
  assert.equal(els[0]?.content, '📢 Trolley Return Procedure Update\nDear Suppliers,\nTo ensure smooth operations')
})

test('空行会切断纯文本块的合并，间距落在后一个元素上', () => {
  const els = elementsOf(blocks('below:', '', '1️⃣ Trolleys must be returned'))
  assert.equal(els.length, 2)
  assert.equal(els[0]?.content, 'below:')
  assert.equal(els[1]?.margin, '22px 0px 0px 0px')
})

test('引用块同样独占元素（引用后的段落曾被吞进引用里）', () => {
  const els = elementsOf(blocks('> quoted line', 'normal line'))
  assert.equal(els.length, 2)
  assert.equal(els[0]?.content, '> quoted line')
  assert.equal(els[1]?.content, 'normal line')
})

test('粘贴进来的字面 * / 1. 文本按块级语法独立成元素，不影响相邻块的间距', () => {
  const els = elementsOf(blocks('* F Zone', '', 'tail'))
  assert.equal(els.length, 2)
  assert.equal(els[0]?.content, '* F Zone')
  assert.equal(els[1]?.margin, '22px 0px 0px 0px')
})

test('嵌套列表整块保留在同一个元素里（缩进是列表语法的一部分）', () => {
  const nested = '- parent\n    - child'
  const els = elementsOf(blocks(nested, 'tail'))
  assert.equal(els[0]?.content, nested)
  assert.equal(els[1]?.content, 'tail')
})

test('行内语法（*斜体* / 数字开头）不算块级语法，照旧合并，不白占元素', () => {
  const els = elementsOf(blocks('*emphasis* opening', '2026 tickets remain', '#hashtag'))
  assert.equal(els.length, 1)
  assert.equal(els[0]?.content, '*emphasis* opening\n2026 tickets remain\n#hashtag')
})

test('--- 这类分割线语法独占元素', () => {
  const els = elementsOf(blocks('above', '---', 'below'))
  assert.deepEqual(
    els.map((e) => e.content),
    ['above', '---', 'below'],
  )
})

test('图片 / 外链按钮 / 分割线按正文出现顺序交错，且沿用待补间距', () => {
  const els = elementsOf(
    blocks('intro', '', '[[FEISHU_IMG:0]]', `[[FEISHU_LINK:https://example.com|查看详情|primary_filled]]`, `${FEISHU_HR_MARKER}`, 'tail'),
    ['img-key-0'],
  )
  assert.deepEqual(
    els.map((e) => e.tag),
    ['markdown', 'img', 'button', 'hr', 'markdown'],
  )
  assert.equal(els[1]?.img_key, 'img-key-0')
  assert.equal(els[1]?.margin, '22px 0px 0px 0px', '空行后紧跟图片时，间距应落在图片元素上')
})

test('未被标记引用的图片仍追加在末尾', () => {
  const els = elementsOf('only text', ['img-a', 'img-b'])
  assert.deepEqual(
    els.map((e) => e.tag),
    ['markdown', 'img', 'img'],
  )
})

test('不含块级标记的正文（如天气块等纯文本来源）按单个元素发出', () => {
  const els = elementsOf('line one\nline two')
  assert.equal(els.length, 1)
  assert.equal(els[0]?.content, 'line one\nline two')
})
