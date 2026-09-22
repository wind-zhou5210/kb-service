import { useState } from 'react'
import { Form, Input, Button, message } from 'antd'
import { UserOutlined, LockOutlined, FileTextOutlined, SafetyCertificateOutlined, DatabaseOutlined } from '@ant-design/icons'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../store/auth'

const FEATURES = [
  { icon: <FileTextOutlined />, title: 'Markdown 渲染', desc: '代码高亮 · 公式 · 图表' },
  { icon: <SafetyCertificateOutlined />, title: 'HTML 沙箱', desc: '安全渲染任意 HTML' },
  { icon: <DatabaseOutlined />, title: '内容寻址', desc: '自动去重，省空间' },
]

export default function Login() {
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const setToken = useAuth((s) => s.setToken)
  const from = (location.state as any)?.from?.pathname || '/'

  // CLI 授权模式：URL 由 kb login 生成，携带回调地址与 PKCE 参数
  const isCliAuth = searchParams.get('cli_callback') === '1'
  const cliRedirectUri = searchParams.get('redirect_uri') || ''
  const cliChallenge = searchParams.get('code_challenge') || ''
  const cliState = searchParams.get('state') || ''

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    setErrorText('')
    try {
      if (isCliAuth) {
        // 授权模式：换取携带一次性授权码的回调地址后跳转，CLI 在本机接收
        const { redirect } = await api.cliAuthorize({
          username: values.username,
          password: values.password,
          redirect_uri: cliRedirectUri,
          code_challenge: cliChallenge,
          state: cliState,
        })
        window.location.href = redirect
        return
      }
      const { access_token } = await api.login(values.username, values.password)
      setToken(access_token)
      navigate(from, { replace: true })
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      const fallback = isCliAuth ? '授权失败，请重试' : '用户名或密码错误'
      if (isCliAuth) setErrorText(typeof detail === 'string' ? detail : fallback)
      else message.error(fallback)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      {/* 左侧品牌区 */}
      <div className="login-brand">
        <div className="login-brand-top">
          <div className="login-brand-logo">
            <div className="login-brand-mark">K</div>
            <span>文件知识库</span>
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="reg-mark" aria-hidden="true" style={{ color: 'var(--brand-ink)', opacity: 0.6 }}><span className="dot" /></span>
            <span className="login-brand-spec">SELF-HOSTED · KB</span>
          </span>
        </div>

        <div className="login-brand-hero">
          <h1>你的知识，<br />你来掌控</h1>
          <p>自托管的文件型知识库，支持 Markdown 与 HTML 原貌渲染</p>
        </div>

        <div className="login-brand-features">
          {FEATURES.map((f) => (
            <div key={f.title} className="login-feature">
              <div className="login-feature-icon">{f.icon}</div>
              <div>
                <div className="login-feature-title">{f.title}</div>
                <div className="login-feature-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧表单区 */}
      <div className="login-form-side">
        <div className="login-form-wrap">
          {isCliAuth && (
            <div className="login-cli-notice">
              <strong>kb-cli 正在请求登录</strong>
              <span>登录后将授权该命令行工具访问你的知识库，凭据仅保存在你本机</span>
            </div>
          )}
          <div className="login-form-header">
            <h2>欢迎回来</h2>
            <p>登录以管理你的知识集合</p>
          </div>

          <Form layout="vertical" onFinish={onFinish} initialValues={{ username: 'admin' }} size="large">
            <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined style={{ color: 'var(--ink-300)' }} />} placeholder="用户名" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined style={{ color: 'var(--ink-300)' }} />} placeholder="密码" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading} style={{ height: 42, marginTop: 4 }}>
              登录
            </Button>
          </Form>

          {errorText && <div className="login-error-text">{errorText}</div>}

          <div className="login-hint">
            本地默认账户 admin / admin123 · 登录后请尽快修改
          </div>
        </div>
      </div>
    </div>
  )
}
