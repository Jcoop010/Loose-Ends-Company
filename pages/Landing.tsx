import { useState } from 'react'
import { useRouter } from '../router'
import { useStore } from '../store'
import { persistPublicLead } from '../cloud'
import { Zap, Menu, X, Check, TrendingUp } from 'lucide-react'

// NOTE (2026-11-15): This page is the undeployed React marketing surface. The
// production site serves a static app shell. Copy here must stay accurate:
// self-service software, deterministic evidence rules, owner-approved actions,
// $199/month single plan. No outcome is guaranteed or implied.

export function LandingPage() {
  const { navigate } = useRouter()
  const { addLead } = useStore()
  const [mobileMenu, setMobileMenu] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [form, setForm] = useState({ name: '', business: '', phone: '', email: '', businessType: '', biggestProblem: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await persistPublicLead(form)
      // Keep an authenticated workspace copy when one exists, while the public
      // capture above guarantees the lead is never lost just because the visitor
      // has not created an account yet.
      addLead(form)
      setSubmitted(true)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'We could not submit your request. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const scrollToHow = () => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })
  const scrollToPricing = () => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })
  const scrollToWalkthrough = () => {
    setTimeout(() => document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  return (
    <div className="min-h-screen bg-white">
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-brand-600 rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-slate-900 tracking-tight">Loose Ends Co.</span>
            </div>
            <div className="hidden md:flex items-center gap-6">
              <button onClick={scrollToHow} className="text-sm font-medium text-slate-600 hover:text-slate-900">How It Works</button>
              <button onClick={scrollToPricing} className="text-sm font-medium text-slate-600 hover:text-slate-900">Pricing</button>
              <a href="/revenue-checkup.html" className="text-sm font-medium text-slate-600 hover:text-slate-900">Free Checkup</a>
              <button onClick={() => navigate('/dashboard')} className="btn-primary text-sm">View Demo</button>
            </div>
            <button onClick={() => setMobileMenu(!mobileMenu)} className="md:hidden p-2" aria-label="Open menu">
              {mobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
          {mobileMenu && (
            <div className="md:hidden py-3 space-y-2 border-t border-slate-100">
              <button onClick={scrollToHow} className="block w-full text-left px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded">How It Works</button>
              <button onClick={scrollToPricing} className="block w-full text-left px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded">Pricing</button>
              <a href="/revenue-checkup.html" className="block w-full text-left px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded">Free Checkup</a>
              <button onClick={() => navigate('/dashboard')} className="btn-primary text-sm w-full">View Demo</button>
            </div>
          )}
        </div>
      </nav>

      <section className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            FIND THE LEAKS.<br />
            FIX THE PROCESS.<br />
            <span className="text-brand-400">CLOSE THE LOOP.</span>
          </h1>
          <p className="mt-6 text-lg text-slate-300 max-w-2xl mx-auto">
            Loose Ends Co. is business-operations software for small service businesses: customers, estimates, jobs, invoices, and follow-ups in one workspace — with deterministic checks that surface what deserves your attention.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <a href="/revenue-checkup.html" className="btn-accent text-base px-6 py-3">TRY THE FREE 60-SECOND CHECKUP</a>
            <button onClick={scrollToHow} className="btn-secondary text-base px-6 py-3 bg-slate-800 border-slate-600 text-white hover:bg-slate-700">SEE HOW IT WORKS</button>
          </div>
          <p className="mt-4 text-sm text-slate-400">No guaranteed results. You stay in control of every customer interaction.</p>
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-slate-50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-8">Work that gets dropped before it gets done.</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: 'Stale estimates', desc: 'Quotes that went quiet because nobody followed up while they were still warm.' },
              { title: 'Unpaid invoices', desc: 'Completed work with outstanding balances that quietly age in a report.' },
              { title: 'Dormant customers', desc: 'Past customers who might be due for another visit, when it is genuinely appropriate.' },
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-xl p-6 border border-slate-200">
                <div className="w-14 h-14 rounded-xl bg-slate-50 flex items-center justify-center mb-4"><Zap className="w-8 h-8 text-brand-600" /></div>
                <h3 className="font-bold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-8">How It Works</h2>
          <div className="space-y-6">
            {[
              { step: '01', title: 'Your records become one workspace', desc: 'Create your workspace and import or enter customers, estimates, jobs, invoices, and tasks — one place instead of scattered files and memory.' },
              { step: '02', title: 'Deterministic checks surface opportunities', desc: 'The software flags stale quotes, aging invoices, dormant customers, and overdue tasks with the evidence behind each flag. No magic scores — just your data, consistently reviewed.' },
              { step: '03', title: 'You decide, the system tracks', desc: 'Every customer contact is your decision. The software tracks follow-ups, completed work, and collected payments so you can see what is actually moving.' },
            ].map((item, i) => (
              <div key={i} className="flex gap-4 items-start">
                <div className="w-12 h-12 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0">{item.step}</div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-1">{item.title}</h3>
                  <p className="text-sm text-slate-600">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="lead-form" className="py-16 px-4 sm:px-6 lg:px-8 bg-slate-50">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-2">Request a walkthrough</h2>
          <p className="text-center text-slate-500 mb-8">We will use your details only to arrange the walkthrough. No payment is due, and nothing is sent to your customers.</p>
          {submitted ? (
            <div className="bg-white rounded-xl p-8 border border-slate-200 text-center">
              <div className="w-16 h-16 rounded-full bg-success-100 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-success-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Request received</h3>
              <p className="text-sm text-slate-600 mb-6">We will reach out to schedule the walkthrough.</p>
              <button onClick={() => navigate('/dashboard')} className="btn-primary">View the Demo Dashboard</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 sm:p-8 border border-slate-200 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Your Name</label>
                  <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input" placeholder="John Smith" />
                </div>
                <div>
                  <label className="label">Business Name</label>
                  <input required value={form.business} onChange={e => setForm({ ...form, business: e.target.value })} className="input" placeholder="Smith's Auto Repair" />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input required value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="input" placeholder="(555) 123-4567" />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="input" placeholder="john@business.com" />
                </div>
              </div>
              <div>
                <label className="label">Business Type</label>
                <input value={form.businessType} onChange={e => setForm({ ...form, businessType: e.target.value })} className="input" placeholder="Auto Repair, HVAC, Plumbing, etc." />
              </div>
              <div>
                <label className="label">What is your biggest operational challenge?</label>
                <textarea value={form.biggestProblem} onChange={e => setForm({ ...form, biggestProblem: e.target.value })} className="input" rows={3} placeholder="Customer follow-up, estimates, invoicing, scheduling, tasks, or other process gaps." />
              </div>
              {submitError && <p role="alert" className="text-sm text-error-600">{submitError}</p>}
              <button type="submit" disabled={submitting} className="btn-accent w-full text-base py-3 disabled:opacity-60">
                <TrendingUp className="w-5 h-5" /> {submitting ? 'SUBMITTING…' : 'REQUEST A WALKTHROUGH'}
              </button>
            </form>
          )}
        </div>
      </section>

      <section id="pricing" className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-2">Simple, Transparent Pricing</h2>
          <p className="text-center text-slate-500 mb-8">One plan. No setup fee. Cancel anytime from your workspace.</p>
          <div className="bg-white rounded-xl p-8 border border-slate-200">
            <h3 className="font-bold text-slate-900 mb-1">Loose Ends OS</h3>
            <p className="text-4xl font-bold text-brand-600 mb-4">$199<span className="text-base font-normal text-slate-500">/month</span></p>
            <ul className="space-y-2 text-sm text-slate-600">
              {['Customers, estimates, jobs, invoices, and tasks in one workspace', 'Deterministic opportunity checks on your own records', 'Follow-up task priorities with the underlying evidence', 'Owner-approved customer communications — never automated sending', 'Workspace reporting on completed work and collected payments', 'Cancel anytime; no long-term contract'].map((f, i) => (
                <li key={i} className="flex items-center gap-2"><Check className="w-4 h-4 text-success-600" /> {f}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 mt-6">Results depend on your business, your records, and your follow-through. No recovery amount is guaranteed or implied. Payment is handled by Stripe after you sign in.</p>
          </div>
        </div>
      </section>

      <footer className="py-8 px-4 sm:px-6 lg:px-8 bg-slate-900 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Zap className="w-5 h-5 text-brand-400" />
          <span className="font-bold text-white text-sm tracking-tight">Loose Ends Co.</span>
        </div>
        <p className="text-xs text-slate-400">Business operations & revenue recovery software. No results guaranteed.</p>
      </footer>
    </div>
  )
}
