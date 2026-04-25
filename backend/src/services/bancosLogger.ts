export function logBancosServiceEvent(event: string, data: Record<string, unknown>) {
  console.info(JSON.stringify({
    scope: 'bancos.service',
    event,
    ...data,
    timestampUtc: new Date().toISOString(),
  }))
}
