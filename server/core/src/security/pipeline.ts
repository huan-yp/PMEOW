import { UnifiedReport, AppSettings, SecurityEventRecord } from '../types.js';
import { analyzeReport } from './analyzer.js';
import * as securityDb from '../db/security-events.js';

export function processSecurityCheck(serverId: string, report: UnifiedReport, settings: AppSettings): SecurityEventRecord[] {
  const findings = analyzeReport(serverId, report, settings);
  const newEvents: SecurityEventRecord[] = [];

  for (const finding of findings) {
    const existing = securityDb.findOpenSecurityEvent(finding.serverId, finding.eventType, finding.fingerprint);
    if (!existing) {
      newEvents.push(securityDb.createSecurityEvent(finding));
    }
  }

  return newEvents;
}
