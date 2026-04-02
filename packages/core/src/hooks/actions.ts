import { exec } from 'child_process';
import type { HookAction, TemplateContext } from '../types.js';

export type NotifyCallback = (title: string, body: string) => void;

let notifyCallback: NotifyCallback = () => {};

export function setNotifyCallback(cb: NotifyCallback): void {
  notifyCallback = cb;
}

export async function executeAction(action: HookAction, context: TemplateContext): Promise<string> {
  switch (action.type) {
    case 'exec_local':
      return execLocal(replaceTemplate(action.command, context));

    case 'http_request':
      return httpRequest(
        replaceTemplate(action.url, context),
        action.method,
        replaceHeaders(action.headers, context),
        replaceTemplate(action.body, context)
      );

    case 'desktop_notify':
      return desktopNotify(
        replaceTemplate(action.title, context),
        replaceTemplate(action.body, context)
      );

    default:
      throw new Error(`Unknown action type: ${(action as HookAction).type}`);
  }
}

function execLocal(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(command, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`Exit ${err.code}: ${stderr || err.message}`));
      } else {
        resolve(stdout.trim());
      }
    });
    child.unref?.();
  });
}

async function httpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string
): Promise<string> {
  const opts: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(30000),
  };
  if (method !== 'GET' && body) {
    opts.body = body;
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return `HTTP ${res.status}: ${text.slice(0, 200)}`;
}

function desktopNotify(title: string, body: string): Promise<string> {
  notifyCallback(title, body);
  return Promise.resolve('Notification sent');
}

function replaceTemplate(template: string, ctx: TemplateContext): string {
  return template
    .replace(/\{\{serverName\}\}/g, ctx.serverName)
    .replace(/\{\{serverHost\}\}/g, ctx.serverHost)
    .replace(/\{\{gpuMemUsage\}\}/g, String(ctx.gpuMemUsage))
    .replace(/\{\{gpuUtil\}\}/g, String(ctx.gpuUtil))
    .replace(/\{\{gpuIdleMinutes\}\}/g, String(ctx.gpuIdleMinutes))
    .replace(/\{\{timestamp\}\}/g, ctx.timestamp)
    .replace(/\{\{cpuUsage\}\}/g, String(ctx.cpuUsage))
    .replace(/\{\{memUsage\}\}/g, String(ctx.memUsage));
}

function replaceHeaders(headers: Record<string, string>, ctx: TemplateContext): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    result[k] = replaceTemplate(v, ctx);
  }
  return result;
}
