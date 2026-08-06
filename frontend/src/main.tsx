import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App'
import { useTheme } from './store/theme'

function Root() {
  const currentTheme = useTheme((s) => s.theme)

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: currentTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: currentTheme === 'dark' ? '#7C9CEB' : '#3A5BD9',
          colorInfo: currentTheme === 'dark' ? '#7C9CEB' : '#3A5BD9',
          colorLink: currentTheme === 'dark' ? '#7C9CEB' : '#3A5BD9',
          colorError: currentTheme === 'dark' ? '#E07A72' : '#B93A32',
          borderRadius: 6,
          // P0-2：antd 控件层进入制图世界 —— 全局继承 IBM Plex Sans
          fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          fontSize: 14,
          colorBorder: currentTheme === 'dark' ? '#2C2D34' : '#DCD9CE',
          colorBorderSecondary: currentTheme === 'dark' ? '#2C2D34' : '#E4E2D8',
          colorBgContainer: currentTheme === 'dark' ? '#1A1B21' : '#FBFBF7',
          colorBgElevated: currentTheme === 'dark' ? '#212228' : '#FFFFFF',
          colorText: currentTheme === 'dark' ? '#EAE8E2' : '#1E1D1A',
          colorTextSecondary: currentTheme === 'dark' ? '#96938A' : '#5F5C53',
          colorTextTertiary: currentTheme === 'dark' ? '#6A6861' : '#7B776C',
          colorTextQuaternary: currentTheme === 'dark' ? '#4F4E49' : '#9C988C',
          colorBgLayout: currentTheme === 'dark' ? '#131419' : '#F4F3EE',
        },
        components: {
          Button: { fontWeight: 500, borderRadius: 6 },
          Card: { borderRadiusLG: 8 },
          Modal: { borderRadiusLG: 8 },
          Input: { borderRadius: 6 },
          Menu: {
            borderRadiusLG: 6,
            itemHoverBg: 'var(--subtle-bg)',
            itemSelectedBg: 'var(--accent-tint)',
            itemSelectedColor: 'var(--accent-press)',
          },
          Tree: { nodeSelectedBg: 'var(--accent-tint)', nodeHoverBg: 'var(--subtle-bg)' },
          Timeline: { dotBg: 'var(--surface)', tailColor: 'var(--border)' },
          Select: { optionSelectedBg: 'var(--accent-tint)', optionSelectedColor: 'var(--accent-press)' },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
