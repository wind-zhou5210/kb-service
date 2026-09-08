export interface Collection {
  id: number;
  name: string;
  description: string | null;
  cover: string | null;
  sort_order: number;
  share_token: string | null;
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
  /** 文档包（zip）入口文件所在目录，用于解析 md 内相对图片路径 */
  source_dir: string | null;
  current_version: number;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

/** 上传接口统一返回结构（单文件批量与文档包共用） */
export interface UploadResult {
  created: DocumentItem[];
  updated: DocumentItem[];
  duplicated: string[];
}

export interface Workspace {
  id: number;
  name: string;
  description: string | null;
  storage_path: string;
  share_token: string | null;
  /** 列表/详情接口附带统计 */
  file_count?: number;
  total_size?: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceTreeNode {
  name: string;
  type: 'file' | 'directory';
  /** 文件节点的工作空间内相对路径 */
  path?: string;
  children?: WorkspaceTreeNode[];
  /** 非 md/html 视为资产（图片等） */
  is_asset?: boolean;
}

/** 工作空间单文件 upsert 结果 */
export interface WorkspaceFileResult {
  status: 'created' | 'updated' | 'unchanged';
  path: string;
  sha1: string;
  size: number;
}

export interface SearchResult {
  document_id: number;
  title: string;
  ext: string;
  collection_id: number;
  collection_name: string;
  snippet: string;
}

export interface DocumentVersion {
  id: number;
  document_id: number;
  version: number;
  content_sha1: string;
  filename: string;
  ext: string;
  size: number;
  change_note: string | null;
  created_at: string;
}
