/**
 * 供应商日报综合排名徽章 —— 占标题左侧序号位。
 * Top 3 呈现金银铜奖牌质感 + 皇冠；其余层级显示带颜色的排名数字。
 */
import { Crown } from 'lucide-react'
import type { VendorRankingResult } from '../../../../shared/vendorAnalysis/rankingScore'
import { useVendorSnapshotTranslation } from '../../../i18n/hooks'

function rankTier(
  ranking: VendorRankingResult,
): 'gold' | 'silver' | 'bronze' | 'strong' | 'mid' | 'weak' | 'muted' {
  if (ranking.sampleInsufficient) return 'muted'
  if (ranking.rank === 1) return 'gold'
  if (ranking.rank === 2) return 'silver'
  if (ranking.rank === 3) return 'bronze'
  const third = Math.ceil(ranking.poolSize / 3)
  if (ranking.rank <= third) return 'strong'
  if (ranking.rank > Math.ceil((ranking.poolSize * 2) / 3)) return 'weak'
  return 'mid'
}

export function VendorRankPlate({ ranking }: { ranking: VendorRankingResult }) {
  const { t } = useVendorSnapshotTranslation()
  if (ranking.poolSize < 2) return null

  const tier = rankTier(ranking)
  const showCrown = ranking.rank <= 3

  return (
    <span
      className={`vs-rank-badge vs-rank-badge--${tier}${showCrown ? ' vs-rank-badge--crowned' : ''}`}
      role="status"
      title={
        ranking.sampleInsufficient
          ? t('ranking.sampleInsufficient')
          : `${t('ranking.rankPrefix')}${ranking.rank} / ${ranking.score.toFixed(1)}${t('ranking.scoreUnit')}`
      }
    >
      {showCrown && (
        <span className="vs-rank-badge__crown" aria-hidden>
          <Crown size={10} strokeWidth={2} fill="currentColor" />
        </span>
      )}
      <span className="vs-rank-badge__rank tabular-nums" aria-hidden>
        {ranking.rank}
      </span>
    </span>
  )
}
