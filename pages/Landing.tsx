import { useState } from 'react'
import { useRouter } from '../router'
import { useStore } from '../store'
import { Zap, Menu, X, Check, DollarSign, CalendarCheck, Bell, TrendingUp, Users, Workflow, BarChart3 } from 'lucide-react'

export function LandingPage() {
  const { navigate } = useRouter()
  const { addLead } = useStore()
  const [mobileMenu, setMobileMenu] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState({ name: '', business: '', phone: '', email: '', businessType: '', biggestProblem: '' })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    addLead(form)
    setSubmitted(true)
  }

  const scrollToAudit = () => {
    setTimeout(() => document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' }), 100)
  }
  const scrollToHow = () => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className="min-h-screen bg-white">
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-brand-600 rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-slate-900 tracking-tight">Primal Directive</span>
            </div>
            <div className="hidden md:flex items-center gap-6">
              <button onClick={scrollToHow} className="text-sm font-medium text-slate-600 hover:text-slate-900">How It Works</button>
              <button onClick={() => document.getElementById('capabilities')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm font-medium text-slate-600 hover:text-slate-900">Capabilities</button>
              <button onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm font-medium text-slate-600 hover:text-slate-900">Pricing</button>
              <button onClick={scrollToAudit} className="text-sm font-medium text-slate-600 hover:text-slate-900">Free Audit</button>
              <button onClick={() => navigate('/dashboard')} className="btn-primary text-sm">View Demo</button>
            </div>
            <button onClick={() => setMobileMenu(!mobileMenu)} className="md:hidden p-2">
              {mobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
          {mobileMenu && (
            <div className="md:hidden py-3 space-y-2 border-t border-slate-100">
              <button onClick={scrollToHow} className="block w-full text-left px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded">How It Works</button>
              <button onClick={() => document.getElementById('capabilities')?.scrollIntoView({ behavior: 'smooth' })} className="block w-full text-left px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded">Capabilities</button>
              <button onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })} className="block w-full text-left px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded">Pricing</button>
              <button onClick={scrollToAudit} className="block w-full text-left px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded">Free Audit</button>
              <button onClick={() => navigate('/dashboard')} className="btn-primary text-sm w-full">View Demo</button>
            </div>
          )}
        </div>
      </nav>

      <section className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-sm font-semibold tracking-widest text-brand-400 mb-4">PRIMAL DIRECTIVE</p>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            RUN THE BUSINESS.<br />
            CLOSE THE GAPS.<br />
            <span className="text-brand-400">GROW WITH CONTROL.</span>
          </h1>
          <p className="mt-6 text-lg text-slate-300 max-w-2xl mx-auto">
            Primal Directive is a multifunctional operating system for small businesses — bringing customers, sales, scheduling, tasks, revenue intelligence, and automation into one command center.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={scrollToAudit} className="btn-accent text-base px-6 py-3">GET YOUR FREE BUSINESS AUDIT</button>
            <button onClick={scrollToHow} className="btn-secondary text-base px-6 py-3 bg-slate-800 border-slate-600 text-white hover:bg-slate-700">SEE HOW IT WORKS</button>
          </div>
          <p className="mt-4 text-sm text-slate-400">Keep the tools you already use. Primal Directive connects the work, finds gaps, and drives the next action.</p>
        </div>
      </section>

      <section id="capabilities" className="py-16 px-4 sm:px-6 lg:px-8 bg-slate-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-3">One operating layer for the whole business.</h2>
          <p className="text-center text-slate-600 max-w-2xl mx-auto mb-10">Instead of adding another disconnected app, use one system to see what matters, assign what happens next, and automate repeatable work.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: <Users className="w-8 h-8 text-brand-600" />, title: 'Customers & Sales', desc: 'Manage customer relationships, opportunities, sales orders, and the pipeline from first contact through close.' },
              { icon: <CalendarCheck className="w-8 h-8 text-accent-600" />, title: 'Operations', desc: 'Coordinate appointments, tasks, documents, requests, and follow-ups so work does not disappear between tools.' },
              { icon: <TrendingUp className="w-8 h-8 text-success-600" />, title: 'Revenue Intelligence', desc: 'Surface missed opportunities, aging leads, unpaid work, inactive customers, and other signals that deserve action.' },
              { icon: <Workflow className="w-8 h-8 text-brand-600" />, title: 'Automation', desc: 'Turn recurring business rules into workflows that can run automatically, on schedules, or with approval when judgment is needed.' },
              { icon: <Bell className="w-8 h-8 text-error-600" />, title: 'Alerts & Follow-Up', desc: 'Put urgent items and next actions in front of the right people before they become lost revenue or operational problems.' },
              { icon: <BarChart3 className="w-8 h-8 text-accent-600" />, title: 'Business Intelligence', desc: 'Give owners a practical view of performance, activity, bottlenecks, and recovery instead of forcing them to piece it together.' },
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-xl p-6 border border-slate-200">
                <div className="w-14 h-14 rounded-xl bg-slate-50 flex items-center justify-center mb-4">{item.icon}</div>
                <h3 className="font-bold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-3">How It Works</h2>
          <p className="text-center text-slate-600 max-w-2xl mx-auto mb-8">Primal Directive turns scattered business activity into a repeatable operating loop.</p>
          <div className="space-y-6">
            {[
              { step: '01', title: 'Connect The Business', desc: 'Bring customers, sales, appointments, tasks, documents, and other operational data into a shared workspace.' },
              { step: '02', title: 'Detect What Needs Attention', desc: 'Revenue and operational signals identify stalled opportunities, overdue work, follow-ups, customer risks, and process gaps.' },
              { step: '03', title: 'Drive The Next Action', desc: 'Create tasks, follow-ups, updates, approvals, and automated workflows so important work keeps moving.' },
              { step: '04', title: 'Measure The Result', desc: 'Track activity and recovered value to understand what is working, where the business is leaking, and what to improve next.' },
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
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-2">Get Your Free Business Audit</h2>
          <p className="text-center text-slate-500 mb-8">We'll identify operational gaps, revenue opportunities, and automation opportunities in your business — no cost, no obligation.</p>
          {submitted ? (
            <div className="bg-white rounded-xl p-8 border border-slate-200 text-center">
              <div className="w-16 h-16 rounded-full bg-success-100 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-success-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Thank you!</h3>
              <p className="text-sm text-slate-600 mb-6">We've received your request and will be in touch within 24 hours to schedule your free audit.</p>
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
                <input value={form.businessType} onChange={e => setForm({ ...form, businessType: e.target.value })} className="input" placeholder="Auto Repair, HVAC, Plumbing, Dental, Retail, etc." />
              </div>
              <div>
                <label className="label">What's your biggest business challenge?</label>
                <textarea value={form.biggestProblem} onChange={e => setForm({ ...form, biggestProblem: e.target.value })} className="input" rows={3} placeholder="Tell us what's slowing the business down, costing revenue, or falling through the cracks..." />
              </div>
              <button type="submit" className="btn-accent w-full text-base py-3">
                <DollarSign className="w-5 h-5" /> GET MY FREE AUDIT
              </button>
            </form>
          )}
        </div>
      </section>

      <section id="pricing" className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 text-center mb-3">Simple, Transparent Pricing</h2>
          <p className="text-center text-slate-600 max-w-2xl mx-auto mb-8">A practical operating layer designed to pay for itself through better execution, recovered revenue, and less administrative waste.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-8 border border-slate-200">
              <h3 className="font-bold text-slate-900 mb-1">Monthly Plan</h3>
              <p className="text-3xl font-bold text-brand-600 mb-4">$499<span className="text-base font-normal text-slate-500">/month</span></p>
              <ul className="space-y-2 text-sm text-slate-600">
                {['Customer & sales workspace', 'Operations & follow-up system', 'Revenue intelligence', 'Workflow automation', 'Unlimited support requests', 'Marketing assistance'].map((f, i) => (
                  <li key={i} className="flex items-center gap-2"><Check className="w-4 h-4 text-success-600" /> {f}</li>
                ))}
              </ul>
            </div>
            <div className="bg-slate-900 rounded-xl p-8 text-white">
              <h3 className="font-bold mb-1">Annual Plan</h3>
              <p className="text-3xl font-bold text-brand-400 mb-4">$4,990<span className="text-base font-normal text-slate-400">/year</span></p>
              <p className="text-sm text-slate-400 mb-4">Save $998 — two months free!</p>
              <ul className="space-y-2 text-sm text-slate-300">
                {['Everything in Monthly', 'Quarterly business reviews', 'Priority support', '2 months free'].map((f, i) => (
                  <li key={i} className="flex items-center gap-2"><Check className="w-4 h-4 text-success-400" /> {f}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-8 px-4 sm:px-6 lg:px-8 bg-slate-900 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Zap className="w-5 h-5 text-brand-400" />
          <span className="font-bold text-white text-sm tracking-tight">Primal Directive</span>
        </div>
        <p className="text-xs text-slate-400">One operating system for customers, sales, operations, automation, and revenue.</p>
      </footer>
    </div>
  )
}
