type ResourceBarProps = {
  label: string
  value: number
  max: number
}

export function ResourceBar({ label, value, max }: ResourceBarProps) {
  const safeMax = Math.max(max, 1)
  const percentage = Math.max(0, Math.min(100, (value / safeMax) * 100))

  return (
    <div className="resource">
      <div className="resource__label">
        <span>{label}</span>
        <span>
          {value}/{max}
        </span>
      </div>

      <div
        className="resource__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div
          className="resource__fill"
          data-resource={label.toLowerCase()}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
