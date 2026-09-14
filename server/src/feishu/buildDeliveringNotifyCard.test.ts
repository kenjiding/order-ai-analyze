import assert from 'node:assert/strict'
import test from 'node:test'
import { AUS_TZ } from '../imile/ausTimezone'
import { buildDeliveringNotifyCard } from './buildDeliveringNotifyCard'

test('卡片标题为 Parcels left at the warehouse，并按两类分段', () => {
  const card = buildDeliveringNotifyCard({
    vendorName: 'Acme Logistics',
    stationName: 'Adelaide Hub',
    date: '2026-08-13',
    tz: AUS_TZ.Adelaide,
    outForDelivery: [{ courier: 'John', courierCode: 'C1', waybillNos: ['W1'] }],
    oversizedUncollected: [{ courier: 'Jane', courierCode: 'C2', waybillNos: ['W2', 'W3'] }],
  }) as { header: { title: { content: string } }; elements: Array<{ text?: { content?: string }; content?: string; text_size?: string }> }

  assert.equal(card.header.title.content, '📦 Parcels left at the warehouse - Acme Logistics')
  const intro = card.elements[0]?.text?.content ?? ''
  assert.equal(intro, "<font color='grey'>Station: Adelaide Hub · 2026-08-13 (Adelaide) · 3 parcels total</font>")
  assert.doesNotMatch(intro, /Parcels left at the warehouse:/)
  const headings = card.elements.filter((el) => el.text_size === 'heading')
  assert.equal(headings[0]?.content, '**🚚 Dispatched parcels left at the front desk**')
  assert.equal(headings[1]?.content, '**🚫 Parcels not collected by the driver**')
  for (const heading of headings) {
    assert.doesNotMatch(heading.content ?? '', /— \d+ parcels?/)
  }
})

test('现场照片以 img_key 嵌进同一张卡片', () => {
  const card = buildDeliveringNotifyCard({
    vendorName: 'Acme Logistics',
    stationName: 'Adelaide Hub',
    date: '2026-08-13',
    tz: AUS_TZ.Adelaide,
    outForDelivery: [{ courier: 'John', courierCode: 'C1', waybillNos: ['W1'] }],
    oversizedUncollected: [],
    imageKeys: ['img_key_a', 'img_key_b'],
  }) as { elements: Array<{ tag?: string; img_key?: string; scale_type?: string; size?: string }> }

  const imgs = card.elements.filter((el) => el.tag === 'img')
  assert.deepEqual(imgs.map((el) => el.img_key), ['img_key_a', 'img_key_b'])
  for (const img of imgs) {
    assert.equal(img.scale_type, 'crop_center')
    assert.equal(img.size, '240px 180px')
  }
})
