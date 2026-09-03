import { useEffect, useState, useRef } from 'react'
import { useStore } from '../store'
import { STORAGE_KEY } from '../data'
import { PageHeader, SaveBar } from '../components/ui'
import {
  Building2, User, Users, Bell, Wrench, Plug, Eye,
  Check, Download, Upload, Database, RotateCcw,
} from 'lucide-react'

const settingsTabs = [
  { id: 'business', label: 'Business Profile', icon: <Building2 className="w-4 h-4" /> },
  { id: 'owner', label: 'Owner', icon: <User className="w-4 h-4" /> },
  { id: 'staff', label: 'Staff', icon: <Users className="w-4 h-4" /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
  { id: 'services', label: 'Service Categories', icon: <Wrench className="w-4 h-4" /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug className="w-4 h-4" /> },
  { id: 'demo', label: 'Demo Mode', icon: <Eye className="w-4 h-4" /> },
]

export function SettingsPage() {
  const { data, resetData, updateBusiness, toggleIntegration } = useStore()
  const [tab, setTab] = useState('business')
  const [saved, setSaved] = useState(false)
  const [businessForm, setBusinessForm] = useState(data.business)

  useEffect(() => {
    setBusinessForm(data.business)
  }, [data.business])
  const fileRef = useRef<HTMLInputElement>(null)
  const [notifications, setNotifications] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`${STORAGE_KEY}_notifications`) || 'null') || {
      missedCalls: true, agingEstimates: true, inactiveCustomers: true, maintenanceDue: true, dailySummary: true,
    } } catch { return { missedCalls: true, agingEstimates: true, inactiveCustomers: true, maintenanceDue: true, dailySummary: true } }
  })
  const handleSave = () => {
    updateBusiness(businessForm)
    try { localStorage.setItem(`${STORAGE_KEY}_notifications`, JSON.stringify(notifications)) } catch {}
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader title="Settings" subtitle="Manage your business configuration." />

      <div className="card p-2">
        <div className="flex gap-1 overflow-x-auto">
          {settingsTabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${tab === t.id ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'business' && (
        <div className="card p-5 space-y-4">
          <h3 className="font-bold text-slate-900">Business Profile</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Business Name</label>
              <input type="text" value={businessForm.name}
              onChange={e => setBusinessForm({ ...businessForm, name: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">Industry</label>
              <input type="text" value={businessForm.industry}
              onChange={e => setBusinessForm({ ...businessForm, industry: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input type="text" value={businessForm.phone}
              onChange={e => setBusinessForm({ ...businessForm, phone: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" value={businessForm.email}
              onChange={e => setBusinessForm({ ...businessForm, email: e.target.value })} className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input type="text" value={businessForm.address}
              onChange={e => setBusinessForm({ ...businessForm, address: e.target.value })} className="input" />
            </div>
          </div>
          <SaveBar onSave={handleSave} saved={saved} />
        </div>
      )}

      {tab === 'owner' && (
        <div className="card p-5 space-y-4">
          <h3 className="font-bold text-slate-900">Owner Profile</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Name</label>
              <input type="text" value={businessForm.owner} onChange={e => setBusinessForm({ ...businessForm, owner: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">Role</label>
              <input type="text" defaultValue="Owner / Operator" className="input" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input type="text" value={businessForm.phone} onChange={e => setBusinessForm({ ...businessForm, phone: e.target.value })} className="input" />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" value={businessForm.email} onChange={e => setBusinessForm({ ...businessForm, email: e.target.value })} className="input" />
            </div>
          </div>
          <SaveBar onSave={handleSave} saved={saved} />
        </div>
      )}

      {tab === 'staff' && (
        <div className="card p-5 space-y-4">
          <h3 className="font-bold text-slate-900">Staff Members</h3>
          <p className="text-sm text-slate-500">Manage staff who have access to the system.</p>
          <div className="space-y-2">
            {[
              { name: data.business.owner, role: 'Owner · Full access', status: 'Active' },
              { name: 'Tom Martinez', role: 'Lead Mechanic · Limited access', status: 'Active' },
              { name: 'Lisa Chen', role: 'Service Advisor · Limited access', status: 'Active' },
            ].map((member, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{member.name}</p>
                  <p className="text-xs text-slate-500">{member.role}</p>
                </div>
                <span className="badge-success text-xs">{member.status}</span>
              </div>
            ))}
          </div>
          <button className="btn-secondary text-sm">
            <Users className="w-4 h-4" /> Add Staff Member
          </button>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="card p-5 space-y-4">
          <h3 className="font-bold text-slate-900">Notification Preferences</h3>
          <div className="space-y-3">
            {Object.keys(notifications).map(key => (
              <div key={key} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <p className="text-sm font-semibold text-slate-900 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                  <p className="text-xs text-slate-500">
                    {key === 'missedCalls' && 'Get notified when a customer call is missed'}
                    {key === 'agingEstimates' && 'Alert when estimates are aging past 7 days'}
                    {key === 'inactiveCustomers' && 'Flag customers who have not returned'}
                    {key === 'maintenanceDue' && 'Remind when maintenance is overdue'}
                    {key === 'dailySummary' && 'Receive a daily summary of priorities'}
                  </p>
                </div>
                <button
                  onClick={() => setNotifications({ ...notifications, [key]: !notifications[key as keyof typeof notifications] })}
                  className={`relative w-12 h-6 rounded-full transition-colors ${notifications[key as keyof typeof notifications] ? 'bg-brand-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${notifications[key as keyof typeof notifications] ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
          <SaveBar onSave={handleSave} saved={saved} />
        </div>
      )}

      {tab === 'services' && (
        <div className="card p-5 space-y-4">
          <h3 className="font-bold text-slate-900">Service Categories</h3>
          <p className="text-sm text-slate-500">Define the types of services your business offers.</p>
          <div className="flex flex-wrap gap-2">
            {['Oil Change', 'Brake Service', 'Transmission', 'AC Repair', 'Tire Service', 'Engine Repair', 'Electrical', 'Inspection', 'Diagnostics', 'Exhaust', 'Suspension', 'Battery'].map(s => (
              <span key={s} className="badge-brand px-3 py-1.5 text-sm">{s}</span>
            ))}
          </div>
          <button className="btn-secondary text-sm">
            <Wrench className="w-4 h-4" /> Add Service Category
          </button>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="card p-5 space-y-4">
          <h3 className="font-bold text-slate-900">Integrations</h3>
          <p className="text-sm text-slate-500">Connect your existing tools and services.</p>
          <div className="space-y-3">
            {data.integrations.map(int => (
              <div key={int.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${int.status === 'Connected' ? 'bg-success-100' : 'bg-slate-100'}`}>
                    <Plug className={`w-5 h-5 ${int.status === 'Connected' ? 'text-success-600' : 'text-slate-400'}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{int.name}</p>
                    <p className="text-xs text-slate-500">{int.description}</p>
                  </div>
                </div>
                {int.status === 'Connected' ? (
                  <button onClick={() => toggleIntegration(int.id)} className="badge-success text-xs flex-shrink-0 hover:bg-success-200 transition-colors"><Check className="w-3 h-3" /> Connected</button>
                ) : (
                  <button onClick={() => toggleIntegration(int.id)} className="btn-secondary text-xs flex-shrink-0">Connect</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'demo' && (
        <div className="card p-5 space-y-4">
          <h3 className="font-bold text-slate-900">Demo Mode</h3>
          <p className="text-sm text-slate-500">
            This dashboard is running in demo mode with sample data. All changes are saved locally in your browser.
          </p>
          <div className="p-4 bg-warning-50 border border-warning-200 rounded-lg">
            <p className="text-sm text-warning-800">
              Resetting will restore the original sample data and erase any changes you've made.
            </p>
          </div>
          <div className="border-t border-slate-100 pt-4 mt-2">
            <div className="flex items-center gap-2 mb-3"><Database className="w-4 h-4 text-slate-400" /><p className="text-sm font-semibold text-slate-900">Workspace data</p></div>
            <p className="text-xs text-slate-500 mb-3">Export a portable JSON backup or restore one later. Imported data replaces the current workspace.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${data.business.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-backup.json`; a.click(); URL.revokeObjectURL(url) }} className="btn-secondary text-sm"><Download className="w-4 h-4" /> Export Backup</button>
              <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm"><Upload className="w-4 h-4" /> Import Backup</button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const parsed = JSON.parse(await file.text()); if (!parsed?.business || !Array.isArray(parsed.customers) || !Array.isArray(parsed.opportunities)) throw new Error('Invalid workspace backup'); localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)); window.location.reload() } catch { window.alert('That file is not a valid Loose Ends Co. workspace backup.') } e.currentTarget.value = '' }} />
            </div>
          </div>
          <button onClick={resetData} className="btn-secondary text-sm">
            <RotateCcw className="w-4 h-4" /> Reset Demo Data
          </button>
        </div>
      )}
    </div>
  )
}
