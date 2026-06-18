import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

// 请求拦截：附带 JWT
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('kb_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截：401 跳登录
client.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('kb_token')
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)

export default client

// ---- 类型 ----
export interface Collection {
  id: number
  name: string
  description: string | null
  cover: string | null
  sort_order: number
  share_token: string | null
  created_at: string
  updated_at: string
  doc_count: number
}

export interface DocumentItem {
  id: number
  collection_id: number
  title: string
  filename: string
  ext: string
  content_sha1: string
  size: number
  tags: string | null
  note: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface SearchResult {
  document_id: number
  title: string
  ext: string
  collection_id: number
  collection_name: string
  snippet: string
}

export interface SharedCollection {
  collection: Collection
  documents: DocumentItem[]
}

// ---- API ----
export const api = {
  login: (username: string, password: string) =>
    client.post<{ access_token: string }>('/auth/login', new URLSearchParams({ username, password }))
      .then((r) => r.data),

  listCollections: () =>
    client.get<Collection[]>('/collections').then((r) => r.data),

  createCollection: (name: string, description?: string) =>
    client.post<Collection>('/collections', { name, description }).then((r) => r.data),

  updateCollection: (id: number, data: Partial<Pick<Collection, 'name' | 'description' | 'cover' | 'sort_order'>>) =>
    client.patch<Collection>(`/collections/${id}`, data).then((r) => r.data),

  deleteCollection: (id: number) =>
    client.delete(`/collections/${id}`),

  listDocuments: (colId: number) =>
    client.get<DocumentItem[]>(`/collections/${colId}/documents`).then((r) => r.data),

  uploadDocuments: (colId: number, files: File[]) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    return client.post<DocumentItem[]>(`/collections/${colId}/documents`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },

  getDocument: (id: number) =>
    client.get<DocumentItem>(`/documents/${id}`).then((r) => r.data),

  getRaw: (id: number, format?: 'html') =>
    client.get<string>(`/documents/${id}/raw`, { params: format ? { format } : {} }).then((r) => r.data),

  updateDocument: (id: number, data: Partial<Pick<DocumentItem, 'title' | 'tags' | 'note' | 'sort_order'>>) =>
    client.patch<DocumentItem>(`/documents/${id}`, data).then((r) => r.data),

  deleteDocument: (id: number) =>
    client.delete(`/documents/${id}`),

  search: (q: string) =>
    client.get<SearchResult[]>('/search', { params: { q } }).then((r) => r.data),

  createShareLink: (colId: number) =>
    client.post<{ share_token: string }>(`/collections/${colId}/share`).then((r) => r.data),

  revokeShare: (colId: number) =>
    client.delete(`/collections/${colId}/share`),

  getSharedCollection: (token: string) =>
    client.get<SharedCollection>(`/share/${token}`).then((r) => r.data),
}
