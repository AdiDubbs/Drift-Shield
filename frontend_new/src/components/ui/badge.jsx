import * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 typo-overline transition-colors',
  {
    variants: {
      variant: {
        default: 'border-border bg-secondary/80 text-secondary-foreground',
        mint: 'border-emerald-500/45 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
        crimson: 'border-rose-500/45 bg-rose-500/10 text-rose-600 dark:text-rose-300',
        amber: 'border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        steel: 'border-cyan-500/45 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
        outline: 'border-border text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
