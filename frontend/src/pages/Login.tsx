import { useState } from 'react'
import { Form, Input, Button, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../store/auth'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const setToken = useAuth((s) => s.setToken)
  const from = (location.state as any)?.from?.pathname || '/'

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      const { access_token } = await api.login(values.username, values.password)
      setToken(access_token)
      navigate(from, { replace: true })
    } catch {
      message.error('用户名或密码错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
      }}
    >
      <div style={{ width: 320 }}>
        {/* Logo + 标题 */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: 'var(--ink-900)',
              margin: '0 auto 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            K
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, color: 'var(--ink-900)', letterSpacing: '-0.01em' }}>
            文件知识库
          </h1>
          <p style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 6 }}>
            登录以管理你的知识集合
          </p>
        </div>

        <Form layout="vertical" onFinish={onFinish} initialValues={{ username: 'admin' }} size="large">
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined style={{ color: 'var(--ink-300)' }} />} placeholder="用户名" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined style={{ color: 'var(--ink-300)' }} />} placeholder="密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading} style={{ height: 40 }}>
            登录
          </Button>
        </Form>

        <div
          style={{
            marginTop: 20,
            fontSize: 12,
            color: 'var(--ink-400)',
            textAlign: 'center',
            fontFamily: 'var(--mono)',
          }}
        >
          默认 admin / admin123
        </div>
      </div>
    </div>
  )
}
