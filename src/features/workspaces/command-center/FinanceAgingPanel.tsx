import React, { useRef, useState } from 'react'
import { Check, Pencil, Plus, ReceiptText } from 'lucide-react'
import { formatCurrency, formatDate } from '../../../lib/format'
import { createIdempotencyKey, opsCommand } from '../../../lib/opsCommand'
import type { OpsExpense, OpsInvoiceAgingBucket } from '../../../types/domain'
import { Dialog } from '../../../components/ui/Dialog'
import { Badge, EmptyState } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'

export interface FinanceAgingPanelProps {
  workspaceId: string
  agingBuckets: OpsInvoiceAgingBucket[]
  expenses: OpsExpense[]
  timezone?: string | null
  onExpensesChanged: () => Promise<void> | void
}

interface ExpenseFormState {
  id?: string
  vendor: string
  description: string
  amount: string
  dueAt: string
  paid: boolean
}

const INITIAL_EXPENSE_FORM: ExpenseFormState = {
  vendor: '',
  description: '',
  amount: '',
  dueAt: '',
  paid: false,
}

export function FinanceAgingPanel({
  workspaceId,
  agingBuckets,
  expenses,
  timezone,
  onExpensesChanged,
}: FinanceAgingPanelProps): React.ReactElement {
  const toast = useToast()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<ExpenseFormState>(INITIAL_EXPENSE_FORM)
  const [saving, setSaving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Preserve a single UUID idempotency key per modal form draft so network retries
  // reconcile cleanly inside `ops_command` without creating duplicate bills.
  const activeSaveKeyRef = useRef<string>(createIdempotencyKey())

  const maxBucketAmount = Math.max(
    1,
    ...agingBuckets.map(bucket => (Number.isFinite(bucket.amount) ? bucket.amount : 0)),
  )
  const totalAging = agingBuckets.reduce((sum, b) => sum + b.amount, 0)
  const unpaidBillsTotal = expenses
    .filter(exp => !exp.paid)
    .reduce((sum, exp) => sum + exp.amount, 0)

  const openCreateModal = () => {
    activeSaveKeyRef.current = createIdempotencyKey()
    setForm(INITIAL_EXPENSE_FORM)
    setFormError(null)
    setDialogOpen(true)
  }

  const openEditModal = (expense: OpsExpense) => {
    activeSaveKeyRef.current = createIdempotencyKey()
    setForm({
      id: expense.id,
      vendor: expense.vendor,
      description: expense.description ?? '',
      amount: String(expense.amount),
      dueAt: expense.due_at ? expense.due_at.slice(0, 10) : '',
      paid: expense.paid,
    })
    setFormError(null)
    setDialogOpen(true)
  }

  const handleSaveExpense = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)

    const vendor = form.vendor.trim()
    const parsedAmount = Number(form.amount)
    if (!vendor) {
      setFormError('Vendor name is required.')
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setFormError('Enter a valid non-negative dollar amount.')
      return
    }

    setSaving(true)
    try {
      await opsCommand(
        workspaceId,
        'expense_save',
        {
          id: form.id,
          vendor,
          description: form.description.trim() || null,
          amount: Math.round(parsedAmount * 100) / 100,
          due_at: form.dueAt ? form.dueAt : null,
          paid: form.paid,
        },
        activeSaveKeyRef.current,
      )

      setDialogOpen(false)
      toast.success(
        form.id ? 'Vendor bill updated' : 'Vendor bill saved',
        `${vendor} · ${formatCurrency(parsedAmount)}`,
      )
      await onExpensesChanged()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save vendor bill.')
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePaid = async (expense: OpsExpense) => {
    if (togglingId) return
    setTogglingId(expense.id)
    try {
      await opsCommand(
        workspaceId,
        'expense_update',
        {
          id: expense.id,
          paid: !expense.paid,
        },
        createIdempotencyKey(),
      )
      toast.success(
        !expense.paid ? 'Bill marked paid' : 'Bill reopened as unpaid',
        `${expense.vendor} · ${formatCurrency(expense.amount)}`,
      )
      await onExpensesChanged()
    } catch (err) {
      toast.error(
        'Could not update bill',
        err instanceof Error ? err.message : 'Retry updating vendor bill.',
      )
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Accounts Receivable Invoice Aging */}
      <section
        aria-label="Accounts receivable invoice aging"
        className="exec-surface p-5 sm:p-6 lg:col-span-5 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">Receivables Aging</h2>
            <p className="text-xs text-slate-600">Open & overdue customer invoices by age</p>
          </div>
          <span className="text-sm font-extrabold text-slate-950 tabular-nums">
            {formatCurrency(totalAging)}
          </span>
        </div>

        <div className="space-y-3">
          {agingBuckets.map(bucket => {
            const widthPct =
              bucket.amount > 0 ? Math.max(6, Math.round((bucket.amount / maxBucketAmount) * 100)) : 0
            const barColor =
              bucket.key === 'over_90' || bucket.key === 'days_61_90'
                ? 'bg-rose-600'
                : bucket.key === 'days_31_60' || bucket.key === 'days_1_30'
                  ? 'bg-amber-500'
                  : 'bg-emerald-600'

            return (
              <div key={bucket.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{bucket.label}</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {formatCurrency(bucket.amount)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Right: Vendor Bills & Expenses (`ops_expenses`) */}
      <section
        aria-label="Vendor bills and operational expenses"
        className="exec-surface p-5 sm:p-6 lg:col-span-7 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Vendor Bills & Expenses</h2>
              <Badge tone={unpaidBillsTotal > 0 ? 'amber' : 'emerald'}>
                Due: {formatCurrency(unpaidBillsTotal)}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">
              Supplier invoices and shop expenses recorded via idempotent <code>ops_command</code>.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="exec-btn-primary !px-3.5 !py-2 !text-xs touch-target"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add Vendor Bill
          </button>
        </div>

        {expenses.length === 0 ? (
          <EmptyState
            icon={<ReceiptText className="h-5 w-5" />}
            title="No vendor bills logged yet"
            description="Track supply-house invoices, subcontractor costs, and shop bills alongside your receivables."
            action={
              <button
                type="button"
                onClick={openCreateModal}
                className="exec-btn-secondary !text-xs touch-target"
              >
                Log First Vendor Bill
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {expenses.slice(0, 12).map(expense => {
              const busy = togglingId === expense.id
              return (
                <li
                  key={expense.id}
                  className="flex flex-col gap-2.5 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-slate-900">
                        {expense.vendor}
                      </span>
                      <Badge tone={expense.paid ? 'emerald' : 'amber'}>
                        {expense.paid ? 'Paid' : 'Unpaid'}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-slate-600">
                      {expense.description || 'Operational expense'}
                      {expense.due_at ? ` · Due ${formatDate(expense.due_at, timezone)}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="mr-1 text-sm font-extrabold text-slate-950 tabular-nums">
                      {formatCurrency(expense.amount)}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleTogglePaid(expense)}
                      className="exec-btn-secondary !px-2.5 !py-1.5 !text-xs touch-target"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      {busy ? 'Saving…' : expense.paid ? 'Reopen' : 'Mark Paid'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(expense)}
                      aria-label={`Edit bill from ${expense.vendor}`}
                      className="exec-btn-secondary !px-2.5 !py-1.5 !text-xs touch-target"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={form.id ? 'Edit Vendor Bill' : 'Record Vendor Bill'}
        description="Saved directly to ops_expenses via ops_command with a UUID idempotency receipt."
      >
        <form onSubmit={handleSaveExpense} className="space-y-4">
          {formError ? (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
            >
              {formError}
            </div>
          ) : null}

          <div>
            <label htmlFor="expense-vendor" className="exec-label">
              Supplier / Vendor Name
            </label>
            <input
              id="expense-vendor"
              type="text"
              required
              placeholder="e.g., United Refrigeration"
              value={form.vendor}
              onChange={e => setForm(prev => ({ ...prev, vendor: e.target.value }))}
              className="exec-input"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="expense-amount" className="exec-label">
                Amount ($)
              </label>
              <input
                id="expense-amount"
                type="number"
                required
                min={0}
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={e => setForm(prev => ({ ...prev, amount: e.target.value }))}
                className="exec-input tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="expense-due" className="exec-label">
                Due Date (Optional)
              </label>
              <input
                id="expense-due"
                type="date"
                value={form.dueAt}
                onChange={e => setForm(prev => ({ ...prev, dueAt: e.target.value }))}
                className="exec-input"
              />
            </div>
          </div>

          <div>
            <label htmlFor="expense-desc" className="exec-label">
              Description / PO Reference
            </label>
            <input
              id="expense-desc"
              type="text"
              placeholder="e.g., R-410A cylinders & dual-run capacitors"
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              className="exec-input"
            />
          </div>

          <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={form.paid}
              onChange={e => setForm(prev => ({ ...prev, paid: e.target.checked }))}
              className="h-4 w-4 accent-[#ea580c]"
            />
            Already paid
          </label>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="exec-btn-secondary touch-target"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="exec-btn-primary touch-target"
            >
              {saving ? 'Saving Bill…' : form.id ? 'Save Changes' : 'Record Bill'}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
