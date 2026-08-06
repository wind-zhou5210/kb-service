import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { Button, Dropdown, Input, Tooltip } from 'antd'
import { LogoutOutlined, SearchOutlined, SunOutlined, MoonOutlined, FolderOutlined, BuildOutlined } from '@ant-design/icons'
import { useAuth } from '../store/auth'
import { useTheme } from '../store/theme'
import { useIsMobile } from '../hooks/useMediaQuery'

interface Props {
  children: React.ReactNode
}

export default function AppLayout({ children }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const logout = useAuth((s) => s.logout)
  const currentTheme = useTheme((s) => s.theme)
  const toggleTheme = useTheme((s) => s.toggleTheme)
  const isMobile = useIsMobile()
  const [q, setQ] = useState('')

  const goSearch = () => {
    const trimmed = q.trim()
    navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search')
  }

  // 标题栏图号标注：当前图纸的编号与名称（FIRST VIEWPORT 契约）
  const sheetLabel =
    location.pathname === '/' || location.pathname.startsWith('/collections')
      ? 'SHT-01 · 知识集合'
      : location.pathname.startsWith('/workspaces')
        ? 'SHT-02 · 工作空间'
        : 'SHT-03 · 检索'

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header className="app-header">
        <div className="logo" onClick={() => navigate('/')} style={{ minWidth: 0 }}>
          <div className="logo-mark">K</div>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span>文件知识库</span>
            <span className="logo-spec">KB · 自托管文件知识库</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 8, flexShrink: 0 }}>
          <Tooltip title="集合 · 单文档管理（.md / .html 文件）" placement="bottom">
            <Button
              type={location.pathname === '/' || location.pathname.startsWith('/collections') ? 'primary' : 'text'}
              size="small"
              icon={<FolderOutlined />}
              onClick={() => navigate('/')}
              style={{ borderRadius: 6, fontSize: 13 }}
            >
              知识集合
            </Button>
          </Tooltip>
          <Tooltip title="工作空间 · 按目录结构组织，支持 zip 上传" placement="bottom">
            <Button
              type={location.pathname.startsWith('/workspaces') ? 'primary' : 'text'}
              size="small"
              icon={<BuildOutlined />}
              onClick={() => navigate('/workspaces')}
              style={{ borderRadius: 6, fontSize: 13 }}
            >
              工作空间
            </Button>
          </Tooltip>
        </div>
        {!isMobile && (
          <span className="dim" style={{ flexShrink: 0 }}>{sheetLabel}</span>
        )}
        <div style={{ flex: 1 }} />
        {isMobile ? (
          <Button
            type="text"
            icon={<SearchOutlined />}
            onClick={() => navigate('/search')}
            title="搜索文档"
            aria-label="搜索文档"
            style={{ color: 'var(--ink-500)' }}
          />
        ) : (
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: 'var(--ink-300)', fontSize: 13 }} />}
            placeholder="搜索文档..."
            aria-label="搜索文档"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onPressEnter={goSearch}
            onFocus={(e) => e.target.select()}
            style={{ maxWidth: 240, height: 32, borderRadius: 6 }}
          />
        )}
        <Button
          type="text"
          icon={currentTheme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
          onClick={toggleTheme}
          title={currentTheme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
          aria-label={currentTheme === 'dark' ? '切换亮色模式' : '切换暗色模式'}
          style={{ color: 'var(--ink-500)' }}
        />
        <span className="reg-mark" aria-hidden="true" style={{ color: 'var(--ink-400)', flexShrink: 0 }}><span className="dot" /></span>
        <Dropdown
          menu={{ items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout }] }}
          placement="bottomRight"
        >
          <div
            role="button"
            tabIndex={0}
            aria-label="用户菜单"
            onClick={() => {}}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') (e.target as HTMLElement).click() }}
            style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'var(--subtle-bg)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--ink-600)',
              border: '1px solid var(--border)',
            }}
          >
            A
          </div>
        </Dropdown>
      </header>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }} className="page-fade">{children}</div>
    </div>
  )
}
