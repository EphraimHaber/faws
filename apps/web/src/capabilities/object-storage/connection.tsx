import type { ConnectionRef } from "@faws/kit";
import * as React from "react";

/**
 * The connection a bucket browser reads through.
 *
 * Set once by the page from its route, so every pane and dialog below it is
 * keyed by the same connection and none of them can drift to another one.
 */
const ConnectionContext = React.createContext<ConnectionRef | null>(null);

export function StorageConnectionProvider({
  connection,
  children,
}: {
  connection: ConnectionRef;
  children: React.ReactNode;
}) {
  // Keyed on the two strings, so a page that rebuilds the ref on every render
  // does not refetch every query below it.
  const { provider, id } = connection;
  const value = React.useMemo(() => ({ provider, id }), [provider, id]);
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useStorageConnection(): ConnectionRef {
  const connection = React.useContext(ConnectionContext);
  if (!connection) throw new Error("A bucket browser rendered outside StorageConnectionProvider.");
  return connection;
}
