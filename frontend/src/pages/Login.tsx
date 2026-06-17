import { useState } from 'react'
import { Card, Form, Input, Button, message } from 'antd'
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
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Card style={{ width: 380, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
        <h2 style={{ textAlign: 'center', marginBottom: 24 }}>文件知识库</h2>
        <Form layout="vertical" onFinish={onFinish} initialValues={{ username: 'admin' }}>
          <Form.Item label="用户名" name="username" rules={[{ required: true }]}>
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form>
        <p style={{ textAlign: 'center', color: '#999', marginTop: 16, fontSize: 12 }}>
          默认账号 admin / admin123，生产环境请修改
        </p>
      </Card>
    </div>
  )
}
