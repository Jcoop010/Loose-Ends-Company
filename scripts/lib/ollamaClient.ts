/// <reference path="../node-ambient.d.ts" />
/**
 * scripts/lib/ollamaClient.ts
 *
 * Strictly-typed, dependency-free HTTP client for local Ollama + Google Gemma 4.
 * Uses native Node fetch and AbortSignal.timeout with explicit runtime type-guards.
 */

export type JsonSchemaTypeName =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

export interface JsonSchemaProperty {
  type: JsonSchemaTypeName | readonly JsonSchemaTypeName[];
  description?: string;
  enum?: readonly string[];
  items?: JsonSchemaProperty | JsonSchemaObject;
  properties?: Record<string, JsonSchemaProperty | JsonSchemaObject>;
  required?: readonly string[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, JsonSchemaProperty | JsonSchemaObject>;
  required: readonly string[];
  additionalProperties: boolean;
}

export interface OllamaHealthResult {
  available: boolean;
  hasModel: boolean;
  reason?: string;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: readonly string[];
}

export interface OllamaStructuredRequest {
  baseUrl: string;
  model: string;
  messages: readonly OllamaChatMessage[];
  schema: JsonSchemaObject;
  temperature?: number;
  timeoutMs?: number;
  think?: boolean;
}

export interface OllamaChatResponse {
  model?: string;
  created_at?: string;
  message?: {
    role?: string;
    content?: string;
  };
  done?: boolean;
  done_reason?: string;
  error?: string;
}

interface OllamaTagEntry {
  name?: string;
  model?: string;
}

interface OllamaTagsPayload {
  models?: readonly OllamaTagEntry[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeOllamaBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed || 'http://localhost:11434';
}

function modelMatchesTag(candidateRaw: string, requestedRaw: string): boolean {
  const candidate = candidateRaw.trim().toLowerCase();
  const requested = requestedRaw.trim().toLowerCase();
  if (!candidate || !requested) {
    return false;
  }
  if (candidate === requested) {
    return true;
  }
  if (!requested.includes(':') && candidate === `${requested}:latest`) {
    return true;
  }
  return false;
}

function stripOptionalMarkdownFence(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return trimmed;
}

function extractTagsList(payload: unknown): OllamaTagsPayload | null {
  if (!isPlainRecord(payload)) {
    return null;
  }
  if (payload.models === undefined) {
    return { models: [] };
  }
  if (!Array.isArray(payload.models)) {
    return null;
  }
  const models: OllamaTagEntry[] = [];
  for (const item of payload.models) {
    if (!isPlainRecord(item)) {
      continue;
    }
    models.push({
      name: typeof item.name === 'string' ? item.name : undefined,
      model: typeof item.model === 'string' ? item.model : undefined,
    });
  }
  return { models };
}

function extractChatResponse(payload: unknown): OllamaChatResponse | null {
  if (!isPlainRecord(payload)) {
    return null;
  }
  let parsedMessage: OllamaChatResponse['message'];
  if (isPlainRecord(payload.message)) {
    parsedMessage = {
      role: typeof payload.message.role === 'string' ? payload.message.role : undefined,
      content: typeof payload.message.content === 'string' ? payload.message.content : undefined,
    };
  }
  return {
    model: typeof payload.model === 'string' ? payload.model : undefined,
    created_at: typeof payload.created_at === 'string' ? payload.created_at : undefined,
    message: parsedMessage,
    done: typeof payload.done === 'boolean' ? payload.done : undefined,
    done_reason: typeof payload.done_reason === 'string' ? payload.done_reason : undefined,
    error: typeof payload.error === 'string' ? payload.error : undefined,
  };
}

export async function checkOllamaHealth(
  baseUrl: string,
  model: string,
  timeoutMs = 2000
): Promise<OllamaHealthResult> {
  const cleanBaseUrl = normalizeOllamaBaseUrl(baseUrl);
  const cleanModel = model.trim();
  if (!cleanModel) {
    return { available: false, hasModel: false, reason: 'model_not_configured' };
  }

  try {
    const response = await fetch(`${cleanBaseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return {
        available: false,
        hasModel: false,
        reason: `http_${response.status}`,
      };
    }

    const rawPayload: unknown = await response.json();
    const parsed = extractTagsList(rawPayload);
    if (!parsed) {
      return {
        available: false,
        hasModel: false,
        reason: 'invalid_tags_payload',
      };
    }

    const hasModel = (parsed.models ?? []).some((entry) => {
      const nameMatch = entry.name ? modelMatchesTag(entry.name, cleanModel) : false;
      const modelMatch = entry.model ? modelMatchesTag(entry.model, cleanModel) : false;
      return nameMatch || modelMatch;
    });

    if (!hasModel) {
      return {
        available: true,
        hasModel: false,
        reason: `model_${cleanModel}_not_pulled`,
      };
    }

    return {
      available: true,
      hasModel: true,
    };
  } catch (err: unknown) {
    const reason = err instanceof Error && err.message ? err.message : 'connection_failed';
    return {
      available: false,
      hasModel: false,
      reason,
    };
  }
}

export async function callOllamaStructured<T>(
  req: OllamaStructuredRequest,
  validate: (raw: unknown) => T | null
): Promise<T | null> {
  const cleanBaseUrl = normalizeOllamaBaseUrl(req.baseUrl);
  const cleanModel = req.model.trim();
  if (!cleanModel || req.messages.length === 0) {
    return null;
  }

  const sanitizedMessages = req.messages.map((msg) => {
    const baseMsg: { role: OllamaChatMessage['role']; content: string; images?: string[] } = {
      role: msg.role,
      content: msg.content,
    };
    if (msg.images && msg.images.length > 0) {
      baseMsg.images = [...msg.images];
    }
    return baseMsg;
  });

  try {
    const response = await fetch(`${cleanBaseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cleanModel,
        stream: false,
        think: req.think ?? false,
        messages: sanitizedMessages,
        format: req.schema,
        options: {
          temperature: req.temperature ?? 0.2,
        },
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 90000),
    });

    if (!response.ok) {
      return null;
    }

    const rawOuter: unknown = await response.json();
    const chatResponse = extractChatResponse(rawOuter);
    const content = chatResponse?.message?.content?.trim();
    if (!content) {
      return null;
    }

    const cleanJsonText = stripOptionalMarkdownFence(content);
    const parsedInner: unknown = JSON.parse(cleanJsonText);
    return validate(parsedInner);
  } catch {
    return null;
  }
}
