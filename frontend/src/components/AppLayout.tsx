import { useNavigate } from 'react-router-dom'
import { Dropdown } from 'antd'
import { LogoutOutlined } from '@ant-design/icons'
import { useAuth } from '../store/auth'

interface Props {
  children: React.ReactNode
}

export default function AppLayout({ children }: Props) {
  const navigate = useNavigate()
  const logout = useAuth((s) => s.logout)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="app-header">
        <div className="logo" onClick={() => navigate('/')}>
          <div className="logo-mark">K</div>
          <span>文件知识库</span>
        </div>
        <div style={{ flex: 1 }} />
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
