export type AgentCommandErrorCode =
  | 'offline'
  | 'timeout'
  | 'not_supported'
  | 'not_found'
  | 'invalid_target'
  | 'invalid_input'
  | 'internal';

const ERROR_MESSAGES: Record<AgentCommandErrorCode, string> = {
  offline: 'Agent 未在线',
  timeout: 'Agent 响应超时',
  not_supported: 'Agent 版本不支持此命令',
  not_found: '任务不存在',
  invalid_target: '目标节点不支持该命令',
  invalid_input: '参数非法',
  internal: '内部错误',
};

export class AgentCommandError extends Error {
  readonly code: AgentCommandErrorCode;

  constructor(code: AgentCommandErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'AgentCommandError';
    this.code = code;
  }
}

export function isAgentCommandError(error: unknown): error is AgentCommandError {
  return error instanceof AgentCommandError;
}
