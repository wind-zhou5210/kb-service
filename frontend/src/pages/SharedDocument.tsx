import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Spin, Tag, Space, Empty } from 'antd'
import { api } from '../api/client'
import MarkdownViewer from '../components/MarkdownViewer'
import HtmlSandbox from '../components/HtmlSandbox'
import { formatSize, relativeTime } from '../utils/format'

export default function SharedDocument() {
  const { token } = useParams<{ token: string }>()
  const [doc, setDoc] = useState<{ id: number; title: string; ext: string; size: number; created_at: string } | null>(null)
  const [content, setContent] = useState('')
  const [ext, setExt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const data = await api.getSharedDocument(token)
      setDoc(data.document)
      setContent(data.content)
      setExt(data.ext)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spin /></div>
  }

  if (error || !doc) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', gap: 12 }}>
        <Empty description="分享链接无效或已失效" />
        <Link to="/login">返回登录</Link>
      </div>
    )
  }

  const isMd = ext === '.md'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)',
        borderBottom: '1px solid var(--ink-50)', padding: '12px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Space>
          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-900)' }}>{doc.title}</span>
          <Tag color={isMd ? 'blue' : 'orange'} style={{ borderRadius: 4, fontSize: 11 }}>{doc.ext}</Tag>
          <span style={{ fontSize: 11, color: 'var(--ink-400)', fontFamily: 'var(--mono)' }}>
            {formatSize(doc.size)} · {relativeTime(doc.created_at)} · 只读分享
          </span>
        </Space>
      </div>

      {isMd ? (
        <MarkdownViewer content={content} />
      ) : (
        <div style={{ padding: 24, height: 'calc(100vh - 53px)' }}><HtmlSandbox html={content} fill /></div>
      )}
    </div>
  )
}
