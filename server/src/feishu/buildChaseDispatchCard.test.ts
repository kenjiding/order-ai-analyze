import assert from 'node:assert/strict'
import test from 'node:test'
import { AUS_TZ } from '../imile/ausTimezone'
import type { VendorStagnationSummary } from '../imile/chaseDispatchAggregate'
import { buildChaseDispatchCard } from './buildChaseDispatchCard'

const bodyText = (card: unknown): string => JSON.stringify(card)

const summary = (over: Partial<VendorStagnationSummary> = {}): VendorStagnationSummary => ({
  totalStagnant: 3,
  priorityTotal: 0,
  buckets: [
    {
      bucket: '0-1',
      label: '0~1 天',
      count: 3,
      drivers: [
        {
          driverName: '张三',
          driverCode: 'D1',
          count: 2,
          priorityCount: 0,
          waybills: [],
        },
      ],
    },
  ],
  ...over,
})

const baseParams = {
  vendorName: 'iMile',
  baseDate: '2026-09-08',
  pushTime: '14:00',
  tz: AUS_TZ.Adelaide,
}

test('汇总行保持 Total stagnant + 区间，下一行 Priority Packages；司机为 count / N Priorities', () => {
  const text = bodyText(
    buildChaseDispatchCard({
      ...baseParams,
      summary: summary({
        totalStagnant: 46,
        priorityTotal: 89,
        buckets: [
          {
            bucket: '3-4',
            label: '3~4 天',
            count: 46,
            drivers: [
              {
                driverName: 'ADL-Dar-052-Khushdeep Singh',
                driverCode: 'D21039610601',
                count: 7,
                priorityCount: 2,
                waybills: [],
              },
            ],
          },
        ],
      }),
    }),
  )
  assert.match(text, /\*\*Total stagnant orders\*\*.*46/)
  assert.match(text, /3~4 days: .*46/)
  assert.match(text, /color='purple'>.*Priority Packages:.*89/)
  assert.doesNotMatch(text, /stagnant total/)
  assert.match(text, /Khushdeep Singh \(D21039610601\): .*7.* \/ .*2 Priorities/)
  assert.doesNotMatch(text, /ADL-Dar-052-/)
})

test('司机优先件为 0 时不展示 / 0 Priorities', () => {
  const text = bodyText(buildChaseDispatchCard({ ...baseParams, summary: summary() }))
  assert.match(text, /张三 \(D1\):/)
  assert.doesNotMatch(text, /Priorities/)
})
