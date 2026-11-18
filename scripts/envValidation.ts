/// <reference path="./node-ambient.d.ts" />
// scripts/envValidation.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export const AUTHORITATIVE_SUPABASE_URL = 'https://uehfvpnnoitgybsmdgef.supabase.co';
export const AUTHORITATIVE_APP_URL = 'https://loose-ends-os.vercel.app';

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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPlaceholderValue(raw: string | undefined): boolean {
  const val = (raw ?? '').trim();
  if (!val) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(val));
}

export function resolveSupabaseUrl(): string {
  const raw = (process.env.VITE_SUPABASE_URL ?? '').trim();
  if (!raw || isPlaceholderValue(raw)) {
    return AUTHORITATIVE_SUPABASE_URL;
  }
  return raw;
}

export function resolveServiceRoleKey(): {
  valid: boolean;
  key: string;
  reason?: string;
} {
  const raw = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!raw) {
    return {
      valid: false,
      key: '',
      reason: 'SUPABASE_SERVICE_ROLE_KEY is missing.',
    };
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
      reason: 'SUPABASE_SERVICE_ROLE_KEY is set to a publishable/anon key instead of the service_role key.',
    };
  }
  return { valid: true, key: raw };
}

export interface WorkspaceRow {
  id: string;
  name: string;
}

export async function verifyDatabaseAndWorkspace(
  supabase: SupabaseClient,
  requireWorkspace: boolean
): Promise<{ workspaceId: string | null; workspaceName: string | null }> {
  const configuredWorkspaceId = (process.env.DEFAULT_WORKSPACE_ID ?? '').trim();

  if (configuredWorkspaceId && isPlaceholderValue(configuredWorkspaceId)) {
    throw new Error(
      'DEFAULT_WORKSPACE_ID contains a literal placeholder. Provide a real workspace UUID from public.workspaces.'
    );
  }

  if (configuredWorkspaceId && !UUID_REGEX.test(configuredWorkspaceId)) {
    throw new Error(
      `DEFAULT_WORKSPACE_ID ("${configuredWorkspaceId}") is not a valid UUID.`
    );
  }

  // 1. Verify connectivity and workspace table access
  if (configuredWorkspaceId) {
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('id', configuredWorkspaceId)
      .maybeSingle();

    if (error) {
      throw new Error(`Database connectivity check failed: ${error.message}`);
    }
    const row = data as WorkspaceRow | null;
    if (!row) {
      throw new Error(
        `DEFAULT_WORKSPACE_ID (${configuredWorkspaceId}) does not exist in public.workspaces.`
      );
    }
    return { workspaceId: row.id, workspaceName: row.name };
  }

  // 2. If DEFAULT_WORKSPACE_ID is not specified, inspect public.workspaces
  const { data: workspaces, error: listError } = await supabase
    .from('workspaces')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(5);

  if (listError) {
    throw new Error(`Database connectivity check failed: ${listError.message}`);
  }

  const typedWorkspaces = (workspaces ?? []) as WorkspaceRow[];

  if (typedWorkspaces.length === 1) {
    return {
      workspaceId: typedWorkspaces[0].id,
      workspaceName: typedWorkspaces[0].name,
    };
  }

  if (requireWorkspace && typedWorkspaces.length === 0) {
    throw new Error(
      'No rows found in public.workspaces. Sign in at https://loose-ends-os.vercel.app/dashboard to initialize your workspace first.'
    );
  }

  if (requireWorkspace && typedWorkspaces.length > 1) {
    const summary = typedWorkspaces.map((w) => `${w.id} (${w.name})`).join(', ');
    throw new Error(
      `Multiple workspaces found in public.workspaces: ${summary}. Set DEFAULT_WORKSPACE_ID explicitly so drafts route to the right workspace.`
    );
  }

  return { workspaceId: null, workspaceName: null };
}
