'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('flex flex-col rounded-lg border border-border bg-card', className)}>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium tracking-tight">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className={cn('min-h-0 flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
      <span>{children}</span>
      {hint && <span className="font-mono text-[10px] text-muted-foreground/70">{hint}</span>}
    </label>
  )
}

interface NumberFieldProps {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  decimals?: number
  className?: string
  disabled?: boolean
}

/**
 * Numeric input that keeps a local text state while typing and commits
 * a clamped, parsed number on blur / Enter so partial input never breaks the model.
 */
export function NumberField({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 0.01,
  unit,
  decimals = 2,
  className,
  disabled,
}: NumberFieldProps) {
  const id = useId()
  const [text, setText] = useState(value.toFixed(decimals))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(value.toFixed(decimals))
  }, [value, decimals, focused])

  const commit = () => {
    const parsed = Number.parseFloat(text.replace(',', '.'))
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed))
      onChange(Number(clamped.toFixed(decimals)))
      setText(clamped.toFixed(decimals))
    } else {
      setText(value.toFixed(decimals))
    }
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center rounded-md border border-input bg-surface focus-within:border-ring">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={Number.isFinite(min) ? min : undefined}
          max={Number.isFinite(max) ? max : undefined}
          step={step}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            commit()
          }}
          onChange={(e) => {
            setText(e.target.value)
            const parsed = Number.parseFloat(e.target.value.replace(',', '.'))
            if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="tabular w-full min-w-0 bg-transparent px-2.5 py-1.5 font-mono text-sm text-foreground outline-none disabled:opacity-50"
        />
        {unit && <span className="pr-2.5 font-mono text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}

interface RangeFieldProps {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  decimals?: number
  format?: (v: number) => string
}

export function RangeField({ label, value, onChange, min, max, step = 1, unit, decimals = 0, format }: RangeFieldProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} hint={`${format ? format(value) : value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`}>
        {label}
      </FieldLabel>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  size?: 'sm' | 'md'
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[5px] font-medium transition-colors',
              size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function IconButton({
  children,
  onClick,
  label,
  active,
  className,
}: {
  children: ReactNode
  onClick: () => void
  label: string
  active?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        active && 'border-primary/40 bg-primary/15 text-primary',
        className,
      )}
    >
      {children}
    </button>
  )
}
