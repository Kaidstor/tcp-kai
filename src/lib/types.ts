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
  received?: string;
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
  vars: EnvVar[] | null | undefined;
  collection_id?: number | null; // Link to a specific collection, or null if global
} 

export interface EnvPackRow extends Omit<EnvPack, 'vars'> {
  id: number;
  name: string;
  vars: string | null | undefined;
  collection_id?: number | null; // Link to a specific collection, or null if global
}