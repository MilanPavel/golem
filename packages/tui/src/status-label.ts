import type { ConnectionState } from "@golem/client";

export type ModelInfo = {
  profile: string | null;
  provider: string | null;
  name: string | null;
};

const emptyModel: ModelInfo = { profile: null, provider: null, name: null };

export function statusLabel(state: ConnectionState): string {
  switch (state.status) {
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    case "closed":
      return "closed";
    case "rejected":
      return state.reason;
  }
}

export function modelChip(name: string | null, profile: string | null): string {
  if (name !== null && name.length > 0 && profile !== null && profile.length > 0) {
    return `${name} · ${profile}`;
  }
  if (name !== null && name.length > 0) {
    return name;
  }
  if (profile !== null && profile.length > 0) {
    return profile;
  }
  return "";
}

export function preferModel(session: ModelInfo | null, daemon: ModelInfo | null): ModelInfo {
  if (session === null) {
    return daemon ?? emptyModel;
  }
  return {
    profile: session.profile ?? daemon?.profile ?? null,
    provider: session.provider ?? daemon?.provider ?? null,
    name: session.name ?? daemon?.name ?? null,
  };
}

export function shortCwd(cwd: string, home: string): string {
  if (home.length === 0) {
    return cwd;
  }
  if (cwd === home) {
    return "~";
  }
  const prefix = home.endsWith("/") ? home : `${home}/`;
  if (cwd.startsWith(prefix)) {
    return `~/${cwd.slice(prefix.length)}`;
  }
  return cwd;
}

export function fitStatus(
  parts: { connection: string; model: string; cwd: string },
  columns: number,
): { connection: string; model: string; cwd: string } {
  const gap = 2;
  let connection = parts.connection;
  let model = parts.model;
  let cwd = parts.cwd;
  const width = (nextConnection: string, nextModel: string, nextCwd: string): number =>
    nextConnection.length +
    (nextModel.length > 0 ? gap + nextModel.length : 0) +
    (nextCwd.length > 0 ? gap + nextCwd.length : 0);
  if (width(connection, model, cwd) > columns) {
    cwd = "";
  }
  if (model.length > 0 && width(connection, model, cwd) > columns) {
    const room = columns - connection.length - gap;
    model = room <= 0 ? "" : model.slice(0, room);
  }
  if (connection.length > columns) {
    connection = connection.slice(0, Math.max(0, columns));
  }
  return { connection, model, cwd };
}
