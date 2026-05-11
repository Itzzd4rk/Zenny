type ScoreRingProps = {
  score: number
}

export function ScoreRing({ score }: ScoreRingProps) {
  const normalizedScore = Math.max(0, Math.min(100, score))
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (normalizedScore / 100) * circumference

  return (
    <div className="relative size-28 shrink-0">
      <svg className="size-28 -rotate-90" viewBox="0 0 112 112" aria-hidden="true">
        <circle
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke="#134e4a"
          strokeWidth="10"
        />
        <circle
          className="transition-[stroke-dashoffset] duration-500 ease-out"
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke="#5eead4"
          strokeLinecap="round"
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-2xl font-semibold text-zinc-50">{normalizedScore}</div>
          <div className="text-[11px] uppercase text-zinc-500">score</div>
        </div>
      </div>
    </div>
  )
}
