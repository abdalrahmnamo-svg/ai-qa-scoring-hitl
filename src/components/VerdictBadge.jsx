import { CheckCircle, XCircle } from 'lucide-react'
import { verdictClasses } from '../utils/draftReviewHelpers'

/**
 * Shared total /100 KPI: pass/fail at PASS_THRESHOLD.
 * @param {{ totalScore: number, size?: 'sm' | 'md' | 'lg', showIcon?: boolean, showLabel?: boolean }} props
 */
export default function VerdictBadge({
  totalScore,
  size = 'md',
  showIcon = false,
  showLabel = true,
  className = '',
}) {
  const tone = verdictClasses(totalScore)
  const scoreSize = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-lg' : 'text-2xl'
  const suffixSize = size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-xs' : 'text-base'

  return (
    <div
      className={`${tone.kpi} ${className}`}
      aria-label={`Total score ${totalScore} out of 100, ${tone.passed ? 'pass' : 'fail'}`}
    >
      <div className="flex items-center gap-1.5">
        {showIcon &&
          (tone.passed ? (
            <CheckCircle className={`${tone.text} shrink-0`} size={size === 'lg' ? 24 : 18} aria-hidden />
          ) : (
            <XCircle className={`${tone.text} shrink-0`} size={size === 'lg' ? 24 : 18} aria-hidden />
          ))}
        <span className={`${scoreSize} font-bold leading-none ${tone.text}`}>
          {totalScore}
          <span className={`${suffixSize} font-semibold opacity-80`}>/100</span>
        </span>
      </div>
      {showLabel && (
        <span className={`mt-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.text}`}>
          {tone.passed ? 'Pass' : 'Fail'}
        </span>
      )}
    </div>
  )
}
