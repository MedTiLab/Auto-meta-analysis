export const OPEN_WEBSOCKET_STATE = 1;

export function getConnectedClientUserId(client) {
  return client?.authUserId ?? client?.userId ?? null;
}

export function groupOpenClientsByUserId(clients, openState = OPEN_WEBSOCKET_STATE) {
  const groupedClients = new Map();

  for (const client of clients || []) {
    if (!client || client.readyState !== openState) {
      continue;
    }

    const userId = getConnectedClientUserId(client);
    if (!groupedClients.has(userId)) {
      groupedClients.set(userId, []);
    }

    groupedClients.get(userId).push(client);
  }

  return groupedClients;
}
