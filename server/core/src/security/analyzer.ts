import { createHash } from 'crypto';
import type { UnifiedReport, AppSettings, SecurityEventDetails, SecurityEventType } from '../types.js';

export interface SecurityFinding {
  serverId: string;
  eventType: SecurityEventType;
  fingerprint: string;
  details: SecurityEventDetails;
}

export function analyzeReport(serverId: string, report: UnifiedReport, settings: AppSettings): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const { resourceSnapshot } = report;

  // 1. Mining keywords in process commands
  for (const proc of resourceSnapshot.processes) {
    const cmdLower = proc.command.toLowerCase();
    for (const keyword of settings.securityMiningKeywords) {
      if (cmdLower.includes(keyword.toLowerCase())) {
        const details: SecurityEventDetails = {
          reason: `Process matched mining keyword: ${keyword}`,
          pid: proc.pid,
          user: proc.user,
          command: proc.command,
          keyword,
        };
        findings.push({
          serverId,
          eventType: 'suspicious_process',
          fingerprint: generateFingerprint('suspicious_process', proc.command, proc.user),
          details,
        });
        break; // one finding per process is enough
      }
    }
  }

  // 2. Unowned GPU usage — unknown processes with significant VRAM
  for (const gpu of resourceSnapshot.gpuCards) {
    for (const unknown of gpu.unknownProcesses) {
      if (unknown.vramMb > 100) {
        findings.push({
          serverId,
          eventType: 'unowned_gpu',
          fingerprint: generateFingerprint('unowned_gpu', String(gpu.index), String(unknown.pid)),
          details: {
            reason: `Unknown process using GPU ${gpu.index}`,
            pid: unknown.pid,
            gpuIndex: gpu.index,
            usedMemoryMB: unknown.vramMb,
          },
        });
      }
    }
  }

  return findings;
}

function generateFingerprint(type: string, ...parts: string[]): string {
  const hash = createHash('sha256');
  hash.update(type);
  for (const part of parts) {
    hash.update('|');
    hash.update(part);
  }
  return hash.digest('hex');
}