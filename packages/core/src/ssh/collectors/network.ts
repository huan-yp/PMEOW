import type { SSHManager } from '../manager.js';
import type { NetworkMetrics } from '../../types.js';

// Default probe target. Using a TCP connect against 1.1.1.1:443 (Cloudflare) so the
// check does not depend on ICMP (which is commonly blocked on hardened hosts) and
// does not require extra privileges on the remote side.
const DEFAULT_SSH_INTERNET_PROBE_TARGET = '1.1.1.1:443';
const SSH_INTERNET_PROBE_TIMEOUT_SECONDS = 3;

// Marker string used to split the two phases of the remote script. Chosen so it
// cannot collide with anything /proc/net/dev or bash timing output would print.
const PROBE_SECTION_MARKER = '---PROBE---';

export interface CollectNetworkOptions {
  /** Override probe target (``host:port``). Set to empty string to disable the probe. */
  probeTarget?: string;
  /** Override per-probe connect timeout in seconds. */
  probeTimeoutSeconds?: number;
}

export async function collectNetwork(
  ssh: SSHManager,
  serverId: string,
  options: CollectNetworkOptions = {},
): Promise<NetworkMetrics> {
  const probeTarget = options.probeTarget ?? DEFAULT_SSH_INTERNET_PROBE_TARGET;
  const probeTimeout = options.probeTimeoutSeconds ?? SSH_INTERNET_PROBE_TIMEOUT_SECONDS;
  const script = buildNetworkScript(probeTarget, probeTimeout);
  const output = await ssh.exec(serverId, script);

  // Split the combined output into the /proc/net/dev half and the probe half.
  // The marker is emitted by the remote shell between the two phases, so any
  // error before the marker is isolated from the probe parsing logic.
  const [netdevSection, probeSection = ''] = output.split(PROBE_SECTION_MARKER);

  const metrics = parseNetDevPair(netdevSection);

  if (probeTarget) {
    const probe = parseProbeSection(probeSection, probeTarget);
    metrics.internetReachable = probe.reachable;
    metrics.internetLatencyMs = probe.latencyMs;
    metrics.internetProbeTarget = probeTarget;
    metrics.internetProbeCheckedAt = Date.now();
  }

  return metrics;
}

function buildNetworkScript(probeTarget: string, timeoutSeconds: number): string {
  // The probe uses bash's ``/dev/tcp`` pseudo-device paired with the ``time``
  // builtin. We prefer this over invoking ``curl`` or ``nc`` because:
  //
  // 1. ``/dev/tcp`` is always available on bash without installing anything.
  // 2. The ``timeout`` coreutils binary guarantees we never block past the
  //    configured limit even on a hung connect.
  // 3. Parsing ``time -p`` output is stable across distros (POSIX format).
  //
  // When the target is empty the probe is skipped entirely — the remote host
  // simply emits "DISABLED" after the marker so the parser knows to surface
  // ``internetReachable`` as undefined.
  const netdevPhase = 'cat /proc/net/dev; sleep 0.5; cat /proc/net/dev';
  if (!probeTarget) {
    return `${netdevPhase}\necho "${PROBE_SECTION_MARKER}"\necho "DISABLED"\n`;
  }
  const [host, portRaw] = probeTarget.split(':');
  const port = portRaw || '443';
  // Quote host/port so shell metacharacters in a user-supplied target cannot
  // break out of the redirection.
  const safeHost = shellQuote(host);
  const safePort = shellQuote(port);
  const probePhase = [
    `( { time -p timeout ${timeoutSeconds} bash -c 'exec 9<>/dev/tcp/${safeHost}/${safePort}'; } 2>&1 )`,
    `echo "EXIT=$?"`,
  ].join('\n');
  return `${netdevPhase}\necho "${PROBE_SECTION_MARKER}"\n${probePhase}\n`;
}

function shellQuote(value: string): string {
  // Minimal safe quoting — we only accept the host/port characters we want to
  // allow and drop everything else. This is defensive because the probe
  // target may ultimately come from settings or an env override.
  return value.replace(/[^A-Za-z0-9._-]/g, '');
}

function parseNetDevPair(netdevOutput: string): NetworkMetrics {
  const lines = netdevOutput.trim().split('\n');
  const dataLines = lines.filter(l => l.includes(':') && !l.includes('|'));
  const half = Math.floor(dataLines.length / 2);

  const snapshot1 = parseNetDev(dataLines.slice(0, half));
  const snapshot2 = parseNetDev(dataLines.slice(half));

  let totalRxDiff = 0;
  let totalTxDiff = 0;
  const interfaces: NetworkMetrics['interfaces'] = [];

  for (const [name, s2] of snapshot2) {
    if (name === 'lo') continue; // Skip loopback
    const s1 = snapshot1.get(name);
    if (s1) {
      const rxDiff = s2.rxBytes - s1.rxBytes;
      const txDiff = s2.txBytes - s1.txBytes;
      totalRxDiff += rxDiff;
      totalTxDiff += txDiff;
      interfaces.push({ name, rxBytes: s2.rxBytes, txBytes: s2.txBytes });
    }
  }

  return {
    rxBytesPerSec: Math.round(totalRxDiff / 0.5),
    txBytesPerSec: Math.round(totalTxDiff / 0.5),
    interfaces,
  };
}

interface ProbeParseResult {
  reachable: boolean;
  latencyMs: number | null;
}

export function parseProbeSection(probeSection: string, probeTarget: string): ProbeParseResult {
  const trimmed = probeSection.trim();
  if (!trimmed || trimmed === 'DISABLED') {
    // Probe skipped — tell caller it was disabled; caller will leave the
    // optional fields unset.
    return { reachable: false, latencyMs: null };
  }

  // Look for the ``EXIT=N`` line. A zero exit means both the timeout wrapper
  // and the /dev/tcp redirection succeeded — i.e. the target accepted the
  // TCP connection before the deadline.
  const exitMatch = trimmed.match(/EXIT=(\d+)/);
  if (!exitMatch) {
    return { reachable: false, latencyMs: null };
  }
  const exitCode = parseInt(exitMatch[1], 10);
  if (exitCode !== 0) {
    // Non-zero exit: host unreachable, timeout tripped, or target refused.
    // We still parse latency if ``time -p`` printed one, but report it as
    // null because the connect did not actually succeed.
    void probeTarget;
    return { reachable: false, latencyMs: null };
  }

  // ``time -p`` emits three lines (real/user/sys) separated by spaces.
  // Example:
  //   real 0.12
  //   user 0.00
  //   sys 0.00
  // We use the ``real`` line because it is wall-clock and therefore matches
  // what a user would intuitively call "latency".
  const realMatch = trimmed.match(/real\s+([0-9]+\.[0-9]+)/);
  if (!realMatch) {
    return { reachable: true, latencyMs: null };
  }
  const realSeconds = parseFloat(realMatch[1]);
  if (!isFinite(realSeconds) || realSeconds < 0) {
    return { reachable: true, latencyMs: null };
  }
  return { reachable: true, latencyMs: Math.round(realSeconds * 1000 * 10) / 10 };
}

function parseNetDev(lines: string[]): Map<string, { rxBytes: number; txBytes: number }> {
  const result = new Map<string, { rxBytes: number; txBytes: number }>();
  for (const line of lines) {
    const match = line.match(/^\s*(\w+):\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
    if (match) {
      result.set(match[1], {
        rxBytes: parseInt(match[2]) || 0,
        txBytes: parseInt(match[3]) || 0,
      });
    }
  }
  return result;
}
