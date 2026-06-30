import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Dropdown, Input } from 'antd'
import { LogoutOutlined, SearchOutlined, SunOutlined, MoonOutlined } from '@ant-design/icons'
import { useAuth } from '../store/auth'
import { useTheme } from '../store/theme'

interface Props {
  children: React.ReactNode
}

export default function AppLayout({ children }: Props) {
  const navigate = useNavigate()
  const logout = useAuth((s) => s.logout)
  const { theme: currentTheme, toggleTheme } = useTheme((s) => ({
    theme: s.theme,
    toggleTheme: s.toggleTheme,
  }))
  const [q, setQ] = useState('')

  const goSearch = () => {
    const trimmed = q.trim()
    navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="app-header">
        <div className="logo" onClick={() => navigate('/')}>
          <div className="logo-mark">K</div>
          <span>文件知识库</span>
        </div>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'var(--ink-300)', fontSize: 13 }} />}
          placeholder="搜索文档..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onPressEnter={goSearch}
          onFocus={(e) => e.target.select()}
          style={{ maxWidth: 280, height: 32, borderRadius: 6, marginLeft: 8 }}
        />
        <div style={{ flex: 1 }} />
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
              background: 'var(--ink-100)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--ink-600)',
            }}
          >
            A
          </div>
        </Dropdown>
      </header>
      <div style={{ flex: 1 }} className="page-fade">{children}</div>
    </div>
  )
}
