import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { Button, Dropdown, Input } from 'antd'
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

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header className="app-header">
        <div className="logo" onClick={() => navigate('/')}>
          <div className="logo-mark">K</div>
          <span>文件知识库</span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
          <Button
            type={location.pathname === '/' || location.pathname.startsWith('/collections') ? 'primary' : 'text'}
            size="small"
            icon={<FolderOutlined />}
            onClick={() => navigate('/')}
            style={{ borderRadius: 6, fontSize: 13 }}
          >
            知识集合
          </Button>
          <Button
            type={location.pathname.startsWith('/workspaces') ? 'primary' : 'text'}
            size="small"
            icon={<BuildOutlined />}
            onClick={() => navigate('/workspaces')}
            style={{ borderRadius: 6, fontSize: 13 }}
          >
            工作空间
          </Button>
        </div>
        <div style={{ flex: 1 }} />
        {isMobile ? (
          <Button
            type="text"
            icon={<SearchOutlined />}
            onClick={() => navigate('/search')}
            title="搜索文档"
            style={{ color: 'var(--ink-500)' }}
          />
        ) : (
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: 'var(--ink-300)', fontSize: 13 }} />}
            placeholder="搜索文档..."
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
          style={{ color: 'var(--ink-500)' }}
        />
        <Dropdown
          menu={{ items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout }] }}
          placement="bottomRight"
        >
          <div
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
