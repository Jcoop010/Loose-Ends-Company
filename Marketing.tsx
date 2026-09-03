import { useStore } from '../store'
import { PageHeader } from '../components/ui'
import { Megaphone, Star, FileText, Tag, CheckCircle } from 'lucide-react'

export function Marketing() {
  const { data, updateMarketingTask } = useStore()
  const completeType = (type: string) => {
    const task = data.marketingTasks.find(item => item.type === type && item.status !== 'Complete')
    if (task) updateMarketingTask(task.id, { status: 'In Progress' })
  }

  const markTaskComplete = (id: string) => updateMarketingTask(id, { status: 'Complete' })

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader title="Marketing" subtitle="Your operational marketing center — not a marketing agency dashboard." />

      <div className="card p-4 bg-brand-50 border-brand-200">
        <p className="text-sm text-brand-800 text-center font-medium">
          "We don't replace the software you already use. We help you get more out of it."
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-100 rounded-lg flex items-center justify-center">
                <Megaphone className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Google Business Profile</h3>
                <span className="badge-warning text-xs mt-1">Needs attention</span>
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-600 mb-3">
            Your business hours need updating for the fall schedule. 3 new reviews need responses.
          </p>
          <button onClick={() => completeType('Google Business')} className="btn-primary text-sm w-full">Update Google</button>
        </div>

        <div className="card p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-accent-100 rounded-lg flex items-center justify-center">
                <Star className="w-5 h-5 text-accent-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Reviews</h3>
                <span className="badge-success text-xs mt-1">12 eligible</span>
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-600 mb-3">
            12 customers are eligible for a review request after recent service. 3 new reviews need responses.
          </p>
          <button onClick={() => completeType('Reviews')} className="btn-accent text-sm w-full">Request Reviews</button>
        </div>

        <div className="card p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-100 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Social Content</h3>
                <span className="badge-warning text-xs mt-1">3 posts needed</span>
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-600 mb-3">
            3 posts recommended this week: fall maintenance tip, customer spotlight, brake special.
          </p>
          <button onClick={() => completeType('Content')} className="btn-primary text-sm w-full">Create Posts</button>
        </div>

        <div className="card p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-accent-100 rounded-lg flex items-center justify-center">
                <Tag className="w-5 h-5 text-accent-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Promotions</h3>
                <span className="badge-neutral text-xs mt-1">Fall season</span>
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-600 mb-3">
            Create a fall maintenance promotion for brake inspection and oil change bundle.
          </p>
          <button onClick={() => completeType('Promotions')} className="btn-accent text-sm w-full">Create Promotion</button>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-slate-400" /> Marketing Tasks
        </h3>
        <div className="space-y-3">
          {data.marketingTasks.map(task => (
            <div key={task.id} className="flex items-start justify-between p-4 bg-slate-50 rounded-lg gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="badge-brand text-xs">{task.type}</span>
                  <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                </div>
                <p className="text-sm text-slate-600 mt-1">{task.description}</p>
                {task.dueDate && <p className="text-xs text-slate-500 mt-1">Due: {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>}
              </div>
              <button onClick={() => markTaskComplete(task.id)} className={`badge ${task.status === 'Pending' ? 'badge-warning' : task.status === 'In Progress' ? 'badge-brand' : 'badge-success'} text-xs flex-shrink-0 hover:opacity-80 transition-opacity`} title={task.status === 'Complete' ? 'Completed' : 'Mark complete'}>
                {task.status === 'Complete' ? 'Complete' : 'Mark complete'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
