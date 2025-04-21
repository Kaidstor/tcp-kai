export interface SavedQuery {
  id: string;
  name: string;
  connection: string;
  pattern: string;
  body: string;
  response: string;
}

const STORAGE_KEY = 'savedQueries';

export async function saveQuery(query: Omit<SavedQuery, 'id'>): Promise<SavedQuery> {
  const list: SavedQuery[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const newItem: SavedQuery = { id: Date.now().toString(), ...query };
  list.push(newItem);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  return newItem;
}

export async function getQueries(): Promise<SavedQuery[]> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
} 