export interface Collection {
  id: number;
  name: string;
  pack_id?: number | null;
}

export interface RequestItem {
  id: number;
  collection_id: number;
  name: string;
  url?: string;
  cmd?: string;
  body?: string;
}

export interface HistoryEntry {
  id: number;
  request_id: number;
  sent?: string;
  received?: string;
  timestamp: string;
  execution_time?: number; // Time in milliseconds
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface EnvPack {
  id: number;
  name: string;
  vars: EnvVar[];
} 