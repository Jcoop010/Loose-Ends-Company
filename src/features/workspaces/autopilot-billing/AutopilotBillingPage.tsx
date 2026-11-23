import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Check,
  Copy,
  CreditCard,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sliders,
  Sparkles,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { DEFAULT_AUTONOMY_CONFIG, type WorkspaceAutonomyConfig } from '../../../lib/autonomousOs'
import * as autonomousQueries from '../../../lib/autonomousOs/queries'
import { fetchAllWorkspaceRows, fetchOpsPolicy } from '../../../lib/queries'
import { useWorkspaceRealtime } from '../../../lib/realtime'
import { useAppRouter } from '../../../state/RouterContext'
import { useSession } from '../../../state/SessionContext'
import type {
  OpsBusinessEvent,
  OpsPolicy,
  OpsQueueItem,
  Workflow,
  WorkflowRun,
} from '../../../types/domain'
import { Badge, MetricCardSkeleton } from '../../../components/ui/MetricCard'
import { useToast } from '../../../components/ui/Toast'
import { BillingSubscriptionCard } from './BillingSubscriptionCard'
import { EventQueuesAuditPanel } from './EventQueuesAuditPanel'
import { GrokBotsPanel } from './GrokBotsPanel'
import { OperationsPolicyForm } from './OperationsPolicyForm'
import { WorkflowBuilderPanel } from './WorkflowBuilderPanel'
import { WorkspaceSetupHealth } from './WorkspaceSetupHealth'

type AutopilotTab = 'policies' | 'grok_bots' | 'queues' | 'workflows' | 'setup' | 'billing'

function parseAutopilotTab(raw: string | null): AutopilotTab {
  if (
    raw === 'grok_bots' ||
    raw === 'queues' ||
    raw === 'workflows' ||
    raw === 'setup' ||
    raw === 'billing'
  ) {
    return raw
  }
  return 'policies'
}

interface AutopilotWorkspaceData {
  policy: OpsPolicy | null
  queueItems: OpsQueueItem[]
  businessEvents: OpsBusinessEvent[]
  workflows: Workflow[]
  workflowRuns: WorkflowRun[]
}

export function AutopilotBillingPage(): React.ReactElement {
  const {
    workspace,
    settings,
    subscription,
    isAdminOrOwner,
    refreshWorkspaceContext,
  } = useSession()
  const { getParam, setParams, navigateSection } = useAppRouter()
  const toast = useToast()

  const activeTab = parseAutopilotTab(getParam('tab'))

  const [data, setData] = useState<AutopilotWorkspaceData | null>(null)
  const [autonomyConfig, setAutonomyConfig] =
    useState<WorkspaceAutonomyConfig>(DEFAULT_AUTONOMY_CONFIG)
  const [copiedHubKind, setCopiedHubKind] = useState<'url' | 'config' | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reqSeqRef = useRef(0)
  const workspaceId = workspace?.id ?? null

  const loadAutopilotWorkspace = useCallback(
    async (isBackground = false) => {
      if (!workspaceId) return
      const seq = ++reqSeqRef.current
      const shouldAbort = () => reqSeqRef.current !== seq

      if (isBackground) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        const [policy, queueItems, businessEvents, workflows, workflowRuns, autoCfg] =
          await Promise.all([
            fetchOpsPolicy(workspaceId),
            fetchAllWorkspaceRows<OpsQueueItem>({
              table: 'ops_queue',
              workspaceId,
              shouldAbort,
            }),
            fetchAllWorkspaceRows<OpsBusinessEvent>({
              table: 'ops_business_events',
              workspaceId,
              shouldAbort,
            }),
            fetchAllWorkspaceRows<Workflow>({
              table: 'workflows',
              workspaceId,
              shouldAbort,
            }),
            fetchAllWorkspaceRows<WorkflowRun>({
              table: 'workflow_runs',
              workspaceId,
              shouldAbort,
            }),
            autonomousQueries.fetchWorkspaceAutonomySettings(workspaceId).catch(() => null),
          ])

        if (shouldAbort()) return
        if (!queueItems || !businessEvents || !workflows || !workflowRuns) return

        setData({
          policy,
          queueItems,
          businessEvents,
          workflows,
          workflowRuns,
        })
        if (autoCfg) {
          setAutonomyConfig(autoCfg)
        }
      } catch (err) {
        if (shouldAbort()) return
        setError(
          err instanceof Error ? err.message : 'Unable to load Autopilot & Billing workspace.',
        )
      } finally {
        if (!shouldAbort()) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [workspaceId],
  )

  useEffect(() => {
    void loadAutopilotWorkspace(false)
    return () => {
      reqSeqRef.current += 1
    }
  }, [loadAutopilotWorkspace])

  useWorkspaceRealtime(workspaceId, () => {
    void loadAutopilotWorkspace(true)
  })

  const switchTab = (next: AutopilotTab) => {
    setParams({ tab: next === 'policies' ? null : next })
  }

  if (!workspace || !workspaceId) {
    return <div />
  }

  const tabs: Array<{
    id: AutopilotTab
    label: string
    icon: React.ComponentType<{ className?: string }>
  }> = [
    { id: 'policies', label: 'Policies & Guardrails', icon: Sliders },
    { id: 'grok_bots', label: 'Grok Bots & Approvals', icon: Bot },
    { id: 'queues', label: 'Queues & Audit', icon: ScrollText },
    { id: 'workflows', label: 'Workflows', icon: WorkflowIcon },
    { id: 'setup', label: 'Setup & Integrations', icon: Settings2 },
    { id: 'billing', label: 'Subscription & Billing', icon: CreditCard },
  ]

  const mcpBaseUrl = String(
    import.meta.env.VITE_SUPABASE_URL || 'https://uehfvpnnoitgybsmdgef.supabase.co',
  ).replace(/\/+$/, '')
  const mcpEndpointUrl = `${mcpBaseUrl}/functions/v1/loose-ends-mcp`
  const mcpClientConfig = JSON.stringify(
    {
      mcpServers: {
        'loose-ends-os': {
          type: 'http',
          url: mcpEndpointUrl,
          headers: {
            Authorization: 'Bearer <YOUR_WORKSPACE_MCP_TOKEN>',
          },
        },
      },
    },
    null,
    2,
  )

  const copyHubValue = (kind: 'url' | 'config', value: string, label: string) => {
    void navigator.clipboard?.writeText(value)
    setCopiedHubKind(kind)
    setTimeout(() => setCopiedHubKind(prev => (prev === kind ? null : prev)), 2500)
    toast.success(`${label} copied`, 'Paste directly into Claude Desktop, ChatGPT Actions, or Grok.')
  }

  return (
    <div className="space-y-6">
      {/* BYO-Agent MCP Hub Card */}
      <section
        aria-label="BYO-Agent MCP Hub"
        className="exec-surface border border-slate-800 bg-[#0b1320] p-5 sm:p-6 space-y-4 text-slate-100"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#fb923c]" aria-hidden="true" />
              <h2 className="text-base font-bold text-white">
                BYO-Agent MCP Hub · Connect Claude, ChatGPT, or Grok in 1 Click
              </h2>
              <Badge tone="brand">v2.5.0 · 29 Tools</Badge>
              <Badge tone="emerald">
                Autonomy Dial: {autonomyConfig.autonomy_rules.convert_signed_quote_to_invoice}
              </Badge>
            </div>
            <p className="text-xs text-slate-300">
              Your external AI connects straight to workspace{' '}
              <span className="font-semibold text-white">{workspace.name}</span> over fail-closed
              workspace-scoped MCP tools while enforcing your Global Autonomy Dial and auto dollar cap (
              ${(autonomyConfig.auto_limit_cents / 100).toFixed(2)}).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => navigateSection('autonomy')}
              className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              Tune Autonomy Dial
            </button>
            <button
              type="button"
              onClick={() => copyHubValue('url', mcpEndpointUrl, 'MCP Endpoint URL')}
              className="exec-btn-secondary !px-3 !py-1.5 !text-xs"
            >
              {copiedHubKind === 'url' ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-[#fb923c]" aria-hidden="true" />
              )}
              Copy Endpoint
            </button>
            <button
              type="button"
              onClick={() => copyHubValue('config', mcpClientConfig, 'MCP JSON Snippet')}
              className="exec-btn-primary !px-3.5 !py-1.5 !text-xs"
            >
              {copiedHubKind === 'config' ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Copy Claude / Grok Config
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              MCP Endpoint URL
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-200 break-all">{mcpEndpointUrl}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Registered Tool Surface
            </p>
            <p className="mt-1 font-bold text-white tabular-nums">
              29 Workspace-Scoped Tools (v2.5.0)
            </p>
            <p className="text-[11px] text-slate-400">
              Includes Shadow Mode, CPA Packet, Collections, SOP Compiler &amp; Morning Brief
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0e1726] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Secret Safety Guard
            </p>
            <p className="mt-1 font-semibold text-emerald-300">
              Zero Raw Tokens Printed · Scoped Tokens
            </p>
            <p className="text-[11px] text-slate-400">
              Mint or revoke workspace tokens below in Grok Bots &amp; Approvals.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Autopilot and Billing views"
          className="flex flex-wrap items-center gap-1.5"
        >
          {tabs.map(tab => {
            const Icon = tab.icon
            const selected = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => switchTab(tab.id)}
                className={`touch-target inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition ${
                  selected
                    ? 'bg-[#c2410c] text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          disabled={refreshing}
          onClick={() => void loadAutopilotWorkspace(true)}
          className="exec-btn-secondary !px-3.5 !py-2 !text-xs touch-target self-start sm:self-auto"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm text-rose-900"
        >
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      ) : data ? (
        <>
          {activeTab === 'policies' ? (
            <OperationsPolicyForm
              workspaceId={workspaceId}
              isAdminOrOwner={isAdminOrOwner}
              policy={data.policy}
              defaultTimezone={settings?.timezone}
              onSaved={() => loadAutopilotWorkspace(true)}
            />
          ) : null}

          {activeTab === 'grok_bots' ? (
            <GrokBotsPanel
              workspaceId={workspaceId}
              isAdminOrOwner={isAdminOrOwner}
              timezone={settings?.timezone}
            />
          ) : null}

          {activeTab === 'queues' ? (
            <EventQueuesAuditPanel
              workspaceId={workspaceId}
              isAdminOrOwner={isAdminOrOwner}
              queueItems={data.queueItems}
              businessEvents={data.businessEvents}
              timezone={settings?.timezone}
              onRetried={() => loadAutopilotWorkspace(true)}
            />
          ) : null}

          {activeTab === 'workflows' ? (
            <WorkflowBuilderPanel
              workspaceId={workspaceId}
              isAdminOrOwner={isAdminOrOwner}
              workflows={data.workflows}
              workflowRuns={data.workflowRuns}
              timezone={settings?.timezone}
              onChanged={() => loadAutopilotWorkspace(true)}
            />
          ) : null}

          {activeTab === 'setup' ? (
            <WorkspaceSetupHealth
              workspace={workspace}
              settings={settings}
              isAdminOrOwner={isAdminOrOwner}
              onContextUpdated={refreshWorkspaceContext}
            />
          ) : null}

          {activeTab === 'billing' ? (
            <BillingSubscriptionCard
              workspaceId={workspaceId}
              workspaceName={workspace.name}
              isAdminOrOwner={isAdminOrOwner}
              subscription={subscription}
              timezone={settings?.timezone}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
