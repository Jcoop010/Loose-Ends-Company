/// <reference path="./node-ambient.d.ts" />
/**
 * scripts/parseReceiptLocal.ts
 *
 * Zero-cost local multimodal receipt & vendor bill auditor powered by Ollama + Gemma 4.
 * Recomputes 100% of monetary arithmetic deterministically in integer cents via receiptAudit.ts
 * and stages results into public.staged_ops_actions + public.bot_runs unless --dry-run is set.
 *
 * Usage:
 *   npx tsx scripts/parseReceiptLocal.ts --file <path> [--workspace <uuid>] [--dry-run]
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  callOllamaStructured,
  checkOllamaHealth,
  normalizeOllamaBaseUrl,
} from './lib/ollamaClient';
import {
  RECEIPT_EXTRACTION_SCHEMA,
  buildStagedReceiptAction,
  classifyReceiptFile,
  validateExtractedReceipt,
  verifyReceiptMath,
  type ExtractedReceipt,
  type ReceiptMathVerification,
  type StagedReceiptOpsActionInsert,
} from './lib/receiptAudit';

try {
  process.loadEnvFile?.('.env.local');
} catch {
  // .env.local not present
}
try {
  process.loadEnvFile?.('.env');
} catch {
  // .env not present
}

const AUTHORITATIVE_SUPABASE_URL = 'https://uehfvpnnoitgybsmdgef.supabase.co';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'gemma4:e2b';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRY_RUN_FALLBACK_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /your-project-ref/i,
  /your-service-role-key/i,
  /your-anon-publishable-key/i,
  /your-workspace-id/i,
  /placeholder/i,
  /example/i,
  /todo/i,
  /replace[_-]?me/i,
  /^<.*>$/,
  /^\.+$/,
];

export interface ReceiptCliOptions {
  filePath: string;
  workspaceId: string | null;
  dryRun: boolean;
  baseUrl: string;
  model: string;
}

export interface ReceiptAuditRunOutput {
  receipt: ExtractedReceipt;
  verification: ReceiptMathVerification;
  stagedAction: StagedReceiptOpsActionInsert;
  dryRun: boolean;
  stagedActionId: string | null;
}

function isPlaceholderValue(raw: string | undefined): boolean {
  const val = (raw ?? '').trim();
  if (!val) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(val));
}

function resolveSupabaseUrl(): string {
  const raw = (process.env.VITE_SUPABASE_URL ?? '').trim();
  if (!raw || isPlaceholderValue(raw)) {
    return AUTHORITATIVE_SUPABASE_URL;
  }
  return raw;
}

function resolveServiceRoleKey(): {
  valid: boolean;
  key: string;
  reason?: string;
} {
  const raw = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!raw) {
    return { valid: false, key: '', reason: 'SUPABASE_SERVICE_ROLE_KEY is missing.' };
  }
  if (isPlaceholderValue(raw)) {
    return {
      valid: false,
      key: '',
      reason: 'SUPABASE_SERVICE_ROLE_KEY contains a literal placeholder value.',
    };
  }
  if (raw.startsWith('sb_publishable_')) {
    return {
      valid: false,
      key: '',
      reason:
        'SUPABASE_SERVICE_ROLE_KEY is set to a publishable/anon key instead of the service_role key.',
    };
  }
  return { valid: true, key: raw };
}

interface WorkspaceRow {
  id: string;
  name: string;
}

interface InsertedIdRow {
  id: string;
}

async function resolveTargetWorkspace(
  supabase: SupabaseClient,
  requestedWorkspaceId: string | null
): Promise<{ workspaceId: string; workspaceName: string | null }> {
  const candidate = (requestedWorkspaceId ?? process.env.DEFAULT_WORKSPACE_ID ?? '').trim();
  if (candidate) {
    if (isPlaceholderValue(candidate)) {
      throw new Error('Workspace ID contains a literal placeholder.');
    }
    if (!UUID_REGEX.test(candidate)) {
      throw new Error(`Workspace ID ("${candidate}") is not a valid UUID.`);
    }
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('id', candidate)
      .maybeSingle();
    if (error) {
      throw new Error(`Workspace lookup failed: ${error.message}`);
    }
    const row = data as WorkspaceRow | null;
    if (!row) {
      throw new Error(`Workspace ${candidate} does not exist in public.workspaces.`);
    }
    return { workspaceId: row.id, workspaceName: row.name };
  }

  const { data: workspaces, error: listError } = await supabase
    .from('workspaces')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(5);

  if (listError) {
    throw new Error(`Workspace query failed: ${listError.message}`);
  }
  const typedWorkspaces = (workspaces ?? []) as WorkspaceRow[];
  if (typedWorkspaces.length === 1) {
    return { workspaceId: typedWorkspaces[0].id, workspaceName: typedWorkspaces[0].name };
  }
  if (typedWorkspaces.length === 0) {
    throw new Error('No workspaces found in public.workspaces.');
  }
  throw new Error('Multiple workspaces exist. Pass --workspace <uuid> or set DEFAULT_WORKSPACE_ID.');
}

export function parseReceiptCliArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env
): ReceiptCliOptions {
  let filePath = '';
  let workspaceId: string | null = null;
  let dryRun = false;
  let model = (env.OLLAMA_MODEL ?? '').trim() || DEFAULT_OLLAMA_MODEL;
  let baseUrl = normalizeOllamaBaseUrl(
    (env.OLLAMA_BASE_URL ?? '').trim() || DEFAULT_OLLAMA_BASE_URL
  );

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--file' && i + 1 < argv.length) {
      filePath = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg.startsWith('--file=')) {
      filePath = arg.slice('--file='.length).trim();
      continue;
    }
    if (arg === '--workspace' && i + 1 < argv.length) {
      workspaceId = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg.startsWith('--workspace=')) {
      workspaceId = arg.slice('--workspace='.length).trim();
      continue;
    }
    if (arg === '--model' && i + 1 < argv.length) {
      model = argv[i + 1].trim() || model;
      i += 1;
      continue;
    }
    if (arg.startsWith('--model=')) {
      model = arg.slice('--model='.length).trim() || model;
      continue;
    }
    if (arg === '--base-url' && i + 1 < argv.length) {
      baseUrl = normalizeOllamaBaseUrl(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      baseUrl = normalizeOllamaBaseUrl(arg.slice('--base-url='.length));
      continue;
    }
  }

  if (!filePath) {
    throw new Error(
      'Missing required argument --file <path>. Usage: tsx scripts/parseReceiptLocal.ts --file <path> [--workspace <uuid>] [--dry-run]'
    );
  }

  if (workspaceId !== null && !UUID_REGEX.test(workspaceId)) {
    throw new Error(`Invalid --workspace UUID: "${workspaceId}".`);
  }

  return {
    filePath,
    workspaceId,
    dryRun,
    baseUrl,
    model,
  };
}

export async function runLocalReceiptAudit(
  options: ReceiptCliOptions
): Promise<ReceiptAuditRunOutput> {
  const resolvedPath = resolve(options.filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Receipt file not found: ${resolvedPath}`);
  }

  const stats = statSync(resolvedPath);
  if (!stats.isFile()) {
    throw new Error(`Receipt path is not a regular file: ${resolvedPath}`);
  }

  const classification = classifyReceiptFile(resolvedPath, stats.size);
  const fileName = basename(resolvedPath);

  const health = await checkOllamaHealth(options.baseUrl, options.model, 2000);
  if (!health.available) {
    throw new Error(
      `Local Ollama daemon is unreachable at ${options.baseUrl} (${health.reason ?? 'offline'}). Start Ollama before parsing receipts.`
    );
  }
  if (!health.hasModel) {
    throw new Error(
      `Model "${options.model}" is not pulled in Ollama at ${options.baseUrl}. Run: ollama pull ${options.model}`
    );
  }

  const systemPrompt =
    'You are a strict forensic bookkeeping extraction engine. Extract every vendor receipt or invoice field into exact integer cents (e.g. $12.34 -> 1234, NEVER floats). For each line item, set unit_price_cents and line_total_cents strictly to the integers printed on the document without silently "fixing" math errors—preserve the printed numbers verbatim so downstream accounting code can compute discrepancies. Put any suspicious fees (service fee, fuel surcharge, misc fee, late fee) or duplicate charges into possible_duplicate_or_fee_flags. Use ISO YYYY-MM-DD for invoice_date or null.';

  const userMessage =
    classification.kind === 'image'
      ? {
          role: 'user' as const,
          content: `Extract all fields and line items verbatim from attached receipt/vendor bill image "${fileName}" in integer cents.`,
          images: [readFileSync(resolvedPath).toString('base64')],
        }
      : {
          role: 'user' as const,
          content: `Extract all fields and line items verbatim from receipt/vendor bill file "${fileName}" in integer cents:\n\n${readFileSync(resolvedPath, 'utf8')}`,
        };

  const extracted = await callOllamaStructured<ExtractedReceipt>(
    {
      baseUrl: options.baseUrl,
      model: options.model,
      temperature: 0.1,
      timeoutMs: 180000,
      think: false,
      schema: RECEIPT_EXTRACTION_SCHEMA,
      messages: [{ role: 'system', content: systemPrompt }, userMessage],
    },
    validateExtractedReceipt
  );

  if (!extracted) {
    throw new Error(
      `Ollama (${options.model}) did not return a valid integer-cent receipt JSON structure.`
    );
  }

  const verification = verifyReceiptMath(extracted);

  if (options.dryRun) {
    const dryWorkspaceId =
      options.workspaceId ??
      (UUID_REGEX.test((process.env.DEFAULT_WORKSPACE_ID ?? '').trim())
        ? (process.env.DEFAULT_WORKSPACE_ID ?? '').trim()
        : DRY_RUN_FALLBACK_WORKSPACE_ID);

    const stagedAction = buildStagedReceiptAction({
      workspaceId: dryWorkspaceId,
      receipt: extracted,
      verification,
      sourceFileName: fileName,
      model: options.model,
    });

    return {
      receipt: extracted,
      verification,
      stagedAction,
      dryRun: true,
      stagedActionId: null,
    };
  }

  const supabaseUrl = resolveSupabaseUrl();
  const serviceKeyCheck = resolveServiceRoleKey();
  if (!serviceKeyCheck.valid) {
    throw new Error(
      `Cannot stage receipt audit to Supabase: ${serviceKeyCheck.reason} Use --dry-run to audit locally without staging.`
    );
  }

  const supabase = createClient(supabaseUrl, serviceKeyCheck.key, {
    auth: { persistSession: false },
  });

  const { workspaceId } = await resolveTargetWorkspace(supabase, options.workspaceId);

  const stagedAction = buildStagedReceiptAction({
    workspaceId,
    receipt: extracted,
    verification,
    sourceFileName: fileName,
    model: options.model,
  });

  const { data: insertedAction, error: insertError } = await supabase
    .from('staged_ops_actions')
    .insert({
      workspace_id: stagedAction.workspace_id,
      bot_role: stagedAction.bot_role,
      workspace_domain: stagedAction.workspace_domain,
      action_type: stagedAction.action_type,
      title: stagedAction.title,
      summary: stagedAction.summary,
      amount_cents: stagedAction.amount_cents,
      payload: stagedAction.payload,
      confidence_score: stagedAction.confidence_score,
      status: stagedAction.status,
    })
    .select('id')
    .single();

  if (insertError || !insertedAction) {
    throw new Error(
      `Failed to insert staged_ops_actions record: ${insertError?.message ?? 'unknown error'}`
    );
  }

  const stagedActionId = (insertedAction as InsertedIdRow).id;

  const { error: runLogError } = await supabase.from('bot_runs').insert({
    workspace_id: workspaceId,
    bot_role: 'billing',
    model: options.model,
    mode: 'propose',
    surface: 'local_ollama',
    tool_name: 'parse_receipt_local',
    status: 'completed',
    input_summary: `Local receipt audit (${classification.kind}): ${fileName}`,
    output_json: {
      staged_action_id: stagedActionId,
      action_type: stagedAction.action_type,
      computed_total_cents: verification.computed_total_cents,
      extracted_total_cents: verification.extracted_total_cents,
      discrepancy_cents: verification.discrepancy_cents,
      flags_count: verification.all_flags.length,
    },
  });

  if (runLogError) {
    throw new Error(
      `Staged action ${stagedActionId} saved, but bot_runs audit insert failed: ${runLogError.message}`
    );
  }

  return {
    receipt: extracted,
    verification,
    stagedAction,
    dryRun: false,
    stagedActionId,
  };
}

async function main(): Promise<void> {
  const options = parseReceiptCliArgs(process.argv.slice(2), process.env);
  const result = await runLocalReceiptAudit(options);

  console.log(
    JSON.stringify(
      {
        mode: result.dryRun ? 'dry-run' : 'staged',
        model: options.model,
        staged_action_id: result.stagedActionId,
        action_type: result.stagedAction.action_type,
        vendor_name: result.receipt.vendor_name,
        invoice_number: result.receipt.invoice_number,
        invoice_date: result.receipt.invoice_date,
        currency: result.receipt.currency,
        amount_cents: result.stagedAction.amount_cents,
        computed_subtotal_cents: result.verification.computed_subtotal_cents,
        tax_cents: result.verification.tax_cents,
        computed_total_cents: result.verification.computed_total_cents,
        extracted_total_cents: result.verification.extracted_total_cents,
        discrepancy_cents: result.verification.discrepancy_cents,
        has_math_discrepancy: result.verification.has_math_discrepancy,
        flags: result.verification.all_flags,
        confidence_score: result.stagedAction.confidence_score,
        line_items: result.verification.line_items,
      },
      null,
      2
    )
  );
}

const invokedScript = (process.argv[1] ?? '').replace(/\\/g, '/');
if (
  invokedScript.endsWith('/scripts/parseReceiptLocal.ts') ||
  invokedScript === 'scripts/parseReceiptLocal.ts'
) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Local receipt audit failed: ${message}`);
    process.exit(1);
  });
}
