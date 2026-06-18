export interface Collection {
  id: number;
  name: string;
  description: string | null;
  doc_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentItem {
  id: number;
  collection_id: number;
  title: string;
  filename: string;
  ext: string;
  size: number;
  tags: string | null;
  note: string | null;
  sort_order: number;
  content_sha1: string;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  document_id: number;
  title: string;
  ext: string;
  collection_id: number;
  collection_name: string;
  snippet: string;
}
