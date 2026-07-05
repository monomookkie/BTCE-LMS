import { forwardRef, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string | undefined
  error?: string | undefined
  helperText?: string | undefined
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, id, className, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            'rounded-md border bg-slate-50 px-3 py-1.5 text-sm text-slate-800',
            'transition-colors placeholder:text-slate-400',
            'focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20',
            'disabled:cursor-not-allowed disabled:opacity-60',
            error
              ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20'
              : 'border-slate-200',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...rest}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        {!error && helperText && <p className="text-xs text-slate-500">{helperText}</p>}
      </div>
    )
  },
)
Input.displayName = 'Input'
