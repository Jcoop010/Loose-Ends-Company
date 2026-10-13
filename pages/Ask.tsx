import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { ASK_SUGGESTIONS } from '../data'
import { PageHeader } from '../components/ui'
import { Send, User, Sparkles } from 'lucide-react'
import { supabase } from '../supabase'

interface Message {
  role: 'assistant' | 'user'
  content: string
}

export function AskAssistant() {
  const { data, workspaceId } = useStore()
  const [messages, setMessages] = useState<Message[]>([{
    role: 'assistant',
    content: `Hi, ${data.business.owner.split(' ')[0] || 'there'}! I'm your Loose Ends OS advisor. I can analyze available workspace data, help prioritize revenue-recovery opportunities, and answer broader business questions. I'll be clear about what the data does and doesn't prove. What would you like to work on?`,
  }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  const send = async (suggestion?: string) => {
    const content = (suggestion ?? input).trim()
    if (!content || loading) return
    const userMessage: Message = { role: 'user', content }
    const history = messages.slice(-8)
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    try {
      const { data: result, error } = await supabase.functions.invoke('ai-advisor', {
        body: { question: content, history, workspaceId },
      })
      if (error) {
        let message = error.message || 'The advisor could not answer right now.'
        const context = (error as any).context
        if (context && typeof context.json === 'function') {
          const detail = await context.json().catch(() => null)
          if (typeof detail?.error === 'string') message = detail.error
        }
        throw new Error(message)
      }
      if (typeof result?.answer !== 'string' || !result.answer.trim()) {
        throw new Error(typeof result?.error === 'string' ? result.error : 'The advisor returned no answer. Please try again.')
      }
      setMessages(prev => [...prev, { role: 'assistant', content: result.answer }])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The advisor could not answer right now.'
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I couldn't complete that answer: ${message}\n\nIf this is the first setup, the free AI provider key may still need to be configured. No action has been taken on your records.`,
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 animate-fadeIn flex flex-col h-[calc(100vh-8rem)] lg:h-[calc(100vh-10rem)]">
      <PageHeader title="ASK Loose Ends OS" subtitle="Evidence-first business advice grounded in your workspace data." />
      <div className="card flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-slate-200' : 'bg-brand-600'}`}>
                {msg.role === 'user' ? <User className="w-4 h-4 text-slate-600" /> : <Sparkles className="w-4 h-4 text-white" />}
              </div>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.role === 'user' ? 'bg-brand-600 text-white rounded-tr-sm' : 'bg-slate-100 text-slate-800 rounded-tl-sm'}`}>
                <p className="text-sm whitespace-pre-line">{msg.content}</p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3" role="status" aria-live="polite">
              <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="bg-slate-100 text-slate-600 rounded-2xl rounded-tl-sm px-4 py-3 text-sm">
                Thinking through your question…
              </div>
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-slate-100">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {ASK_SUGGESTIONS.map(s => (
              <button key={s} onClick={() => void send(s)} disabled={loading}
                className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium whitespace-nowrap hover:bg-brand-50 hover:text-brand-700 transition-all flex-shrink-0 disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        </div>
        <form className="p-4 border-t border-slate-100 flex gap-2" onSubmit={e => { e.preventDefault(); void send() }}>
          <input type="text" value={input} onChange={e => setInput(e.target.value)}
            placeholder="Ask a business question…" aria-label="Ask Loose Ends OS"
            disabled={loading} maxLength={4000} className="input flex-1" />
          <button type="submit" disabled={loading || !input.trim()} className="btn-primary flex-shrink-0" aria-label="Send question">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
      <p className="text-xs text-slate-500">AI responses can be wrong. Verify important figures and decisions against source records. The advisor is read-only and will not change records or send messages.</p>
    </div>
  )
}
