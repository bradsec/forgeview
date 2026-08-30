import type { PrepCheck, PrepCheckState } from '../../services/prepChecks'

const STATE_LABEL: Record<PrepCheckState, string> = {
  pass: 'OK',
  warn: 'Check',
  fail: 'Fix needed',
  unavailable: 'Not yet',
}

const STATE_CLASS: Record<PrepCheckState, string> = {
  pass: 'text-[var(--success,#15803d)]',
  warn: 'text-[var(--text-warning,#b45309)]',
  fail: 'text-[var(--error)]',
  unavailable: 'text-[var(--text-muted)]',
}

export function ReadinessCard({
  checks,
  onFix,
}: {
  checks: PrepCheck[]
  onFix: (fixId: string) => void
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--text-label)] uppercase tracking-wide">
        Print readiness
      </h3>
      <ul className="mt-3 flex flex-col gap-2">
        {checks.map((check) => {
          const fixId = check.fixId
          return (
            <li
              key={check.id}
              data-testid={`check-${check.id}`}
              data-state={check.state}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="flex flex-col">
                <span className="text-[var(--text-primary)]">{check.label}</span>
                <span className="text-xs text-[var(--text-muted)]">{check.detail}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-medium ${STATE_CLASS[check.state]}`}>
                  {STATE_LABEL[check.state]}
                </span>
                {fixId && (
                  <button
                    type="button"
                    aria-label={`Fix ${check.label}`}
                    onClick={() => onFix(fixId)}
                    className="px-2 py-0.5 rounded bg-[var(--bg-button)] text-xs"
                  >
                    Fix
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
