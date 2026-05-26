import type { RegressionExpected, RegressionMismatchField } from './types'
import type { OrderAnalyzeResult } from '../types'

export function compareRegressionCase(
  expected: RegressionExpected,
  actual: Pick<OrderAnalyzeResult, 'lossScope' | 'exceptionCategoryId'>
): { pass: boolean; mismatches: RegressionMismatchField[] } {
  const mismatches: RegressionMismatchField[] = []
  if (expected.lossScope !== actual.lossScope) {
    mismatches.push('lossScope')
  }
  const expectedSub = String(expected.exceptionCategoryId ?? '').trim()
  const actualSub = String(actual.exceptionCategoryId ?? '').trim()
  if (expectedSub !== actualSub) {
    mismatches.push('exceptionCategoryId')
  }
  return { pass: mismatches.length === 0, mismatches }
}
