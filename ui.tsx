import type { ReactNode } from 'react'
import {
  DollarSign, TrendingUp, CalendarCheck, AlertTriangle,
  ArrowUpDown, Check, Save, ArrowLeft, Phone, Mail,
  CalendarClock, Wrench, Search, Plus, Send, Zap,
  LayoutDashboard, Users, Bell, Megaphone, ClipboardList,
  MessageSquare, Settings, Menu, X, Sparkles,
  ChevronRight, BellRing, Clock, Star, CheckCircle,
  Building2, Plug, Eye,
} from 'lucide-react'

export {
  DollarSign, TrendingUp, CalendarCheck, AlertTriangle,
  ArrowUpDown, Check, Save, ArrowLeft, Phone, Mail,
  CalendarClock, Wrench, Search, Plus, Send, Zap,
  LayoutDashboard, Users, Bell, Megaphone, ClipboardList,
  MessageSquare, Settings, Menu, X, Sparkles,
  ChevronRight, BellRing, Clock, Star, CheckCircle,
  Building2, Plug, Eye,
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

const accentColors: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-success-50 text-success-600',
  warning: 'bg-warning-50 text-warning-600',
  error: 'bg-error-50 text-error-600',
  accent: 'bg-accent-50 text-accent-600',
  neutral: 'bg-slate-100 text-slate-600',
}

export function StatCard({ label, value, icon, trend, accent = 'brand' }: { label: string; value: string | number; icon?: ReactNode; trend?: string; accent?: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-slate-900">{value}</p>
          {trend && <p className="mt-1 text-xs text-slate-500">{trend}</p>}
        </div>
        {icon && <div className={`p-2.5 rounded-lg ${accentColors[accent]}`}>{icon}</div>}
      </div>
    </div>
  )
}

export function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">{label}</p>
      <p className={`text-sm font-bold mt-0.5 ${highlight ? 'text-success-600' : 'text-slate-900'}`}>{value}</p>
    </div>
  )
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-sm font-semibold text-slate-900 mt-0.5">{value}</p>
    </div>
  )
}

export function CustomerStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active: 'badge-success',
    'Follow-Up Due': 'badge-warning',
    Inactive: 'badge-neutral',
    'Maintenance Due': 'badge-brand',
  }
  return <span className={map[status] || 'badge-neutral'}>{status}</span>
}

export function FollowUpStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    'Due Today': 'badge-error',
    Upcoming: 'badge-warning',
    Completed: 'badge-success',
    Snoozed: 'badge-neutral',
    Dismissed: 'badge-neutral',
  }
  return <span className={map[status] || 'badge-neutral'}>{status}</span>
}

export function OpportunityStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Potential: 'badge-neutral',
    Contacted: 'badge-brand',
    Responded: 'badge-accent',
    Scheduled: 'badge-warning',
    Completed: 'badge-purple',
    Collected: 'badge-success',
  }
  return <span className={map[status] || 'badge-neutral'}>{status}</span>
}

export function OpportunityTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    'Missed Call': 'badge-error',
    'Old Estimate': 'badge-warning',
    'Declined Work': 'badge-accent',
    'Inactive Customer': 'badge-neutral',
    'Maintenance Due': 'badge-brand',
    Other: 'badge-neutral',
  }
  return <span className={map[type] || 'badge-neutral'}>{type}</span>
}

export function AlertTypeBadge({ type, severity }: { type: string; severity: string }) {
  const map: Record<string, string> = {
    urgent: 'badge-error',
    warning: 'badge-warning',
    info: 'badge-brand',
    success: 'badge-success',
  }
  return <span className={map[severity] || 'badge-neutral'}>{type}</span>
}

export function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    High: 'badge-error',
    Medium: 'badge-warning',
    Low: 'badge-neutral',
  }
  return <span className={map[priority] || 'badge-neutral'}>{priority}</span>
}

export function RequestStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    New: 'badge-brand',
    'In Progress': 'badge-warning',
    Waiting: 'badge-neutral',
    Complete: 'badge-success',
  }
  return <span className={map[status] || 'badge-neutral'}>{status}</span>
}

export function SortButton({ active, dir, onClick, label }: { active: boolean; dir: string; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
    >
      {label}
      {active && <ArrowUpDown className={`w-3 h-3 ${dir === 'desc' ? 'rotate-180' : ''}`} />}
    </button>
  )
}

export function SaveBar({ onSave, saved }: { onSave: () => void; saved: boolean }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <button onClick={onSave} className="btn-primary text-sm">
        <Save className="w-4 h-4" /> Save Changes
      </button>
      {saved && (
        <span className="flex items-center gap-1 text-sm text-success-600 font-medium animate-fadeIn">
          <Check className="w-4 h-4" /> Saved!
        </span>
      )}
    </div>
  )
}
