// The Rust side of the app (src-tauri/src/commands.rs): a length-prefixed
// TCP round-trip against a NestJS microservice, cancellable by request id.
import { invoke } from "@tauri-apps/api/core";
import type { ApiResponse } from "./types";

export const api = {
  /** Opens the connection, writes `<len>#{pattern,data,id}` and reads the
   *  reply. Resolves with the raw ApiResponse JSON; rejects when the request
   *  was cancelled. */
  sendTcpRequest: (args: {
    connection: string;
    pattern: string;
    json: string;
    requestId: string;
  }) => invoke<string>("send_tcp_request", args),

  /** Cancels an in-flight request; unknown ids are ignored by the backend. */
  cancelTcpRequest: (requestId: string) =>
    invoke<void>("cancel_tcp_request", { requestId }),
};

/** Parses the ApiResponse envelope the Rust command returns as a string. */
export function parseApiResponse(raw: string): ApiResponse {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as ApiResponse).ok !== "boolean"
  ) {
    throw new Error("Malformed response from the backend");
  }
  return parsed as ApiResponse;
}

export const errText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
