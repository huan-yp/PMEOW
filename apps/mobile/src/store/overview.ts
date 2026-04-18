import type { AuthSession } from '@monitor/app-common';
import { MobileApiClient } from '../lib/api';
import { savePersistedSession, type PersistedMobileSession } from '../lib/storage';
import type { OverviewData } from './types';

export async function loadOverview(client: MobileApiClient, session: AuthSession): Promise<OverviewData> {
  const personTasksPromise = session.authenticated && session.principal.kind === 'person' && session.person
    ? client.getPersonTasks(session.person.id, { limit: 10 })
    : Promise.resolve({ tasks: [], total: 0 });

  const alertsPromise = session.authenticated && session.principal.kind === 'admin'
    ? client.getAlerts({ status: 'active', limit: 6 })
    : Promise.resolve([]);

  const securityEventsPromise = session.authenticated && session.principal.kind === 'admin'
    ? client.getSecurityEvents({ resolved: false, limit: 6 })
    : Promise.resolve([]);

  const [servers, statuses, latestMetrics, alerts, securityEvents, personTasks] = await Promise.allSettled([
    client.getServers(),
    client.getStatuses(),
    client.getLatestMetrics(),
    alertsPromise,
    securityEventsPromise,
    personTasksPromise,
  ]);

  return {
    servers: servers.status === 'fulfilled' ? servers.value : [],
    statuses: statuses.status === 'fulfilled' ? statuses.value : {},
    latestMetrics: latestMetrics.status === 'fulfilled' ? latestMetrics.value : {},
    alerts: alerts.status === 'fulfilled' ? alerts.value : [],
    securityEvents: securityEvents.status === 'fulfilled' ? securityEvents.value : [],
    personTasks: personTasks.status === 'fulfilled' ? personTasks.value.tasks : [],
  };
}

export async function persistState(snapshot: PersistedMobileSession): Promise<void> {
  await savePersistedSession(snapshot);
}