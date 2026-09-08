import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { ASK_SUGGESTIONS } from '../data'
import { formatCurrency } from '../utils'
import { PageHeader } from '../components/ui'
import { MessageSquare, Send, User, Sparkles } from 'lucide-react'
import type { AppData } from '../types'

function generateResponse(query: string, data: AppData): string {
  const q = query.toLowerCase()

  if (q.includes('find me money') || q.includes('find money') || q.includes('biggest opportunity') || q.includes('opportunities')) {
    const opps = data.opportunities.filter(o => o.status === 'Potential').sort((a, b) => b.potentialValue - a.potentialValue)
    const total = opps.reduce((s, o) => s + o.potentialValue, 0)
    const top = opps.slice(0, 5)
    let response = `I found ${opps.length} high-priority opportunities worth approximately ${formatCurrency(total)} in potential revenue.\n\nTop opportunities:\n\n`
    top.forEach((o, i) => {
      response += `${i + 1}. ${o.customerName} — ${formatCurrency(o.potentialValue)}\n   ${o.type} · ${o.nextAction}\n\n`
    })
    response += `Would you like me to show all ${opps.length} opportunities? You can view them in the Revenue Recovery center.`
    return response
  }

  if (q.includes('follow up') || q.includes('follow-up')) {
    const due = data.followUps.filter(f => f.status === 'Due Today')
    let response = `You have ${due.length} follow-ups due today:\n\n`
    due.forEach((f, i) => {
      response += `${i + 1}. ${f.customerName} — ${formatCurrency(f.potentialValue)}\n   ${f.reason}\n   Action: ${f.nextAction}\n\n`
    })
    response += 'I recommend starting with the highest-value follow-up. Head to the Follow-Up Center to log your contacts.'
    return response
  }

  if (q.includes("hasn't been back") || q.includes('inactive') || q.includes("who hasn")) {
    const inactive = data.customers.filter(c => c.status === 'Inactive')
    let response = `You have ${inactive.length} inactive customers who haven't been back in over 6 months:\n\n`
    inactive.slice(0, 5).forEach((c, i) => {
      const v = data.vehicles.find(v => v.id === c.vehicleId)
      response += `${i + 1}. ${c.name} — ${v ? `${v.year} ${v.make} ${v.model}` : 'No vehicle'}\n   LTV: ${formatCurrency(c.lifetimeValue)}\n   Last service: ${c.lastServiceDescription}\n\n`
    })
    response += 'These customers represent significant potential revenue. I recommend a personal win-back call from you for the top 3.'
    return response
  }

  if (q.includes('what should i work on') || q.includes('today') || q.includes('priorit')) {
    const dueToday = data.followUps.filter(f => f.status === 'Due Today')
    const missedCalls = data.opportunities.filter(o => o.type === 'Missed Call' && o.status === 'Potential')
    const maint = data.customers.filter(c => c.status === 'Maintenance Due')
    let response = `Here's what I recommend you focus on today:\n\n`
    response += `1. Follow up with ${dueToday.length} customers due today (${formatCurrency(dueToday.reduce((s, f) => s + f.potentialValue, 0))} in potential revenue)\n`
    response += `2. Return ${missedCalls.length} missed calls\n`
    response += `3. Send maintenance reminders to ${maint.length} overdue customers\n\n`
    response += 'Start with the highest-value follow-up and work your way down. You\'ve got this!'
    return response
  }

  if (q.includes('facebook') || q.includes('social') || q.includes('post')) {
    return `Here's a Facebook post I'd recommend for this week:\n\n"Fall is here! Is your vehicle ready for the cooler months? Right now at Mike's Auto & Service, we're offering a Fall Maintenance Special — brake inspection, oil change, and 25-point check for just $89. Don't wait until the first cold morning to find out your battery is weak. Call us at (555) 123-4567 to schedule!\n\n#AutoRepair #FallMaintenance #SpringfieldOH #MikesAuto"\n\nYou can create more posts in the Marketing center.`
  }

  if (q.includes('overdue') || q.includes('maintenance')) {
    const maint = data.customers.filter(c => c.status === 'Maintenance Due')
    let response = `You have ${maint.length} customers overdue for maintenance:\n\n`
    maint.forEach((c, i) => {
      const v = data.vehicles.find(v => v.id === c.vehicleId)
      response += `${i + 1}. ${c.name} — ${v ? `${v.year} ${v.make} ${v.model}` : ''} (${v?.mileage.toLocaleString()} mi)\n   Last service: ${c.lastServiceDescription}\n\n`
    })
    response += 'I recommend sending a service reminder to all of them. You can set up a campaign in the Marketing center.'
    return response
  }

  if (q.includes('revenue') || q.includes('recover') || q.includes('money')) {
    const recovered = data.opportunities.filter(o => o.status === 'Collected').reduce((s, o) => s + (o.collectedAmount || 0), 0)
    const potential = data.opportunities.filter(o => o.status === 'Potential').reduce((s, o) => s + o.potentialValue, 0)
    return `Here's your revenue recovery snapshot:\n\n• Potential opportunity: ${formatCurrency(potential)}\n• Recovered revenue: ${formatCurrency(recovered)}\n• Recovery rate: ${potential + recovered > 0 ? Math.round(recovered / (potential + recovered) * 1000) / 10 : 0}%\n\nThe biggest opportunity is following up on declined estimates and aging estimates. Check the Revenue Recovery center for details.`
  }

  if (q.includes('alert') || q.includes('urgent')) {
    const urgent = data.alerts.filter(a => !a.dismissed && a.severity === 'urgent')
    let response = `You have ${urgent.length} urgent alerts:\n\n`
    urgent.forEach((a, i) => {
      response += `${i + 1}. ${a.customerName || 'Multiple customers'} — ${a.reason}\n   Action: ${a.recommendedAction}\n\n`
    })
    response += 'Check the Alerts page for all active alerts.'
    return response
  }

  return `I can help you with:\n\n• Finding revenue opportunities ("Find me money")\n• Prioritizing your day ("What should I work on today?")\n• Identifying inactive customers ("Who hasn't been back?")\n• Overdue maintenance customers\n• Creating social media posts\n• Revenue recovery status\n\nTry one of the quick prompts below, or ask me anything about your business!`
}

interface Message {
  role: 'assistant' | 'user'
  content: string
}

export function AskAssistant() {
  const { data } = useStore()
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Good morning, ${data.business.owner.split(' ')[0]}! I'm your Primal Directive assistant. I can help you find revenue opportunities, prioritize your day, and answer questions about your business. What can I help you with?`,
    },
  ])
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const send = (text?: string) => {
    const content = text || input.trim()
    if (!content) return
    const userMsg: Message = { role: 'user', content }
    const assistantMsg: Message = { role: 'assistant', content: generateResponse(content, data) }
    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
  }

  return (
    <div className="space-y-4 animate-fadeIn flex flex-col h-[calc(100vh-8rem)] lg:h-[calc(100vh-10rem)]">
      <PageHeader title="ASK PRIMAL DIRECTIVE" subtitle="Tell me what you need." />

      <div className="card flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-slate-200' : 'bg-brand-600'}`}>
                {msg.role === 'user' ? <User className="w-4 h-4 text-slate-600" /> : <Sparkles className="w-4 h-4 text-white" />}
              </div>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${msg.role === 'user' ? 'bg-brand-600 text-white rounded-tr-sm' : 'bg-slate-100 text-slate-800 rounded-tl-sm'}`}>
                <p className="text-sm whitespace-pre-line">{msg.content}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-slate-100">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {ASK_SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium whitespace-nowrap hover:bg-brand-50 hover:text-brand-700 transition-all flex-shrink-0"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ask me anything about your business..."
              className="input flex-1"
            />
            <button onClick={() => send()} className="btn-primary flex-shrink-0">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
