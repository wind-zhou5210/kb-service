import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Input, Spin, Tag, Empty } from 'antd'
import { SearchOutlined, FileTextOutlined, Html5Outlined, ArrowLeftOutlined } from '@ant-design/icons'
import { api, type SearchResult } from '../api/client'

function highlightSnippet(snippet: string) {
  const parts = snippet.split(/<<|>>/)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} style={{ background: 'var(--accent-tint)', color: 'var(--accent-press)', borderRadius: 2, padding: '0 2px' }}>{part}</mark>
      : <span key={i}>{part}</span>
  )
}

export default function Search() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const q = params.get('q') || ''
  const [input, setInput] = useState(q)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setResults([]); setSearched(false); return }
    setLoading(true); setSearched(true)
    try { setResults(await api.search(query.trim())) }
    catch { setResults([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { setInput(q); doSearch(q) }, [q, doSearch])

  const handleSubmit = (val: string) => {
    const trimmed = val.trim()
    if (trimmed) setParams({ q: trimmed })
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <ArrowLeftOutlined
          onClick={() => navigate('/')}
          style={{ color: 'var(--ink-400)', cursor: 'pointer', fontSize: 14 }}
        />
        <Input
          autoFocus
          allowClear
          size="large"
          prefix={<SearchOutlined style={{ color: 'var(--ink-300)' }} />}
          placeholder="搜索文档内容..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => handleSubmit((e.target as HTMLInputElement).value)}
          style={{ borderRadius: 6 }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : results.length === 0 ? (
        searched ? (
          <Empty
            image={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            description={q ? `未找到「${q}」相关文档` : '输入关键词开始搜索'}
            style={{ marginTop: 60 }}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink-400)', fontSize: 13 }}>
            搜索文件名、集合名和文档正文
          </div>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-400)', fontFamily: 'var(--mono)', marginBottom: 4 }}>
            {results.length} 条结果
          </div>
          {results.map((r) => (
            <div
              key={r.document_id}
              onClick={() => navigate(`/collections/${r.collection_id}?doc=${r.document_id}`)}
              style={{
                padding: '14px 18px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
              className="search-result-item"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {r.ext === '.md' ? <FileTextOutlined style={{ color: 'var(--md-color)', fontSize: 14 }} /> : <Html5Outlined style={{ color: 'var(--html-color)', fontSize: 14 }} />}
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' }}>{r.title}</span>
                <Tag color={r.ext === '.md' ? 'blue' : 'orange'} style={{ borderRadius: 4, fontSize: 10, margin: 0 }}>{r.ext}</Tag>
                <span style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--mono)' }}>· {r.collection_name}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-500)', lineHeight: 1.6 }}>
                {highlightSnippet(r.snippet)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
