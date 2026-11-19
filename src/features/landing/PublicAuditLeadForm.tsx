import React, { useState } from 'react'
import { CheckCircle2, ClipboardCheck, Send } from 'lucide-react'
import { submitPublicLead } from '../../lib/queries'

const BUSINESS_TYPES = [
  'HVAC & Mechanical',
  'Plumbing & Drain',
  'Electrical Contracting',
  'Auto Repair & Fleet',
  'General Contracting',
  'Commercial Property Maintenance',
  'Other Field / Trade Service',
]

export function PublicAuditLeadForm(): React.ReactElement {
  const [name, setName] = useState('')
  const [business, setBusiness] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [businessType, setBusinessType] = useState(BUSINESS_TYPES[0])
  const [biggestProblem, setBiggestProblem] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const trimmedEmail = email.trim()
    const trimmedPhone = phone.trim()
    if (!name.trim() || !business.trim() || !trimmedPhone || !trimmedEmail) {
      setError('Please enter your name, company name, phone number, and work email.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid work email address.')
      return
    }
    if (trimmedPhone.replace(/\D/g, '').length < 7) {
      setError('Enter a valid phone number so we can share your audit summary.')
      return
    }

    setSubmitting(true)
    try {
      await submitPublicLead({
        name,
        business,
        phone: trimmedPhone,
        email: trimmedEmail,
        business_type: businessType,
        biggest_problem: biggestProblem,
      })
      setSubmitted(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Your audit request could not be submitted right now. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="exec-surface p-6 sm:p-8 border-emerald-300 bg-emerald-50/40"
      >
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              Audit Request Received for {business.trim()}
            </h3>
            <p className="mt-1.5 text-sm text-slate-700 leading-relaxed">
              We recorded your request for <strong>{email.trim().toLowerCase()}</strong>. Our
              onboarding team will prepare a 10-minute walkthrough showing how your quotes, parts,
              completed jobs, and unpaid invoices reconcile in one workspace.
            </p>
            <button
              type="button"
              onClick={() => {
                setSubmitted(false)
                setName('')
                setBusiness('')
                setPhone('')
                setEmail('')
                setBiggestProblem('')
              }}
              className="mt-4 exec-btn-secondary !text-xs touch-target"
            >
              Submit Another Request
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="exec-surface p-6 sm:p-8 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]">
          <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900">
            Free 10-Minute Revenue & Billing Leak Audit
          </h3>
          <p className="text-xs text-slate-600">
            See where unapproved quotes, unbilled completed jobs, and past-due invoices stall.
          </p>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
        >
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="lead-name" className="exec-label">
            Your Name
          </label>
          <input
            id="lead-name"
            type="text"
            required
            autoComplete="name"
            placeholder="Elena Vance"
            value={name}
            onChange={e => setName(e.target.value)}
            className="exec-input"
          />
        </div>
        <div>
          <label htmlFor="lead-business" className="exec-label">
            Company Name
          </label>
          <input
            id="lead-business"
            type="text"
            required
            autoComplete="organization"
            placeholder="Ridgeway HVAC & Mechanical"
            value={business}
            onChange={e => setBusiness(e.target.value)}
            className="exec-input"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="lead-email" className="exec-label">
            Work Email
          </label>
          <input
            id="lead-email"
            type="email"
            required
            autoComplete="email"
            placeholder="elena@ridgewayhvac.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="exec-input"
          />
        </div>
        <div>
          <label htmlFor="lead-phone" className="exec-label">
            Direct Phone
          </label>
          <input
            id="lead-phone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="(555) 214-8801"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="exec-input"
          />
        </div>
      </div>

      <div>
        <label htmlFor="lead-trade" className="exec-label">
          Primary Trade / Industry
        </label>
        <select
          id="lead-trade"
          value={businessType}
          onChange={e => setBusinessType(e.target.value)}
          className="exec-input"
        >
          {BUSINESS_TYPES.map(trade => (
            <option key={trade} value={trade}>
              {trade}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="lead-problem" className="exec-label">
          Where do jobs or invoices slip through the cracks today? (Optional)
        </label>
        <textarea
          id="lead-problem"
          rows={3}
          placeholder="e.g., Techs finish emergency calls before parts & labor get billed, or $4k+ replacement quotes sit unapproved."
          value={biggestProblem}
          onChange={e => setBiggestProblem(e.target.value)}
          className="exec-input"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="exec-btn-primary w-full touch-target"
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {submitting ? 'Submitting Audit Request…' : 'Request My 10-Minute Leak Audit'}
      </button>
    </form>
  )
}
