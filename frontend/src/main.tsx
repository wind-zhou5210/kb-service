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
          colorPrimary: currentTheme === 'dark' ? '#818CF8' : '#4F46E5',
          colorInfo: currentTheme === 'dark' ? '#818CF8' : '#4F46E5',
          borderRadius: 6,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          fontSize: 14,
          colorBorder: currentTheme === 'dark' ? '#27272A' : '#E4E4E7',
          colorBgContainer: currentTheme === 'dark' ? '#18181B' : '#FFFFFF',
          colorBgElevated: currentTheme === 'dark' ? '#1F1F23' : '#FFFFFF',
          colorText: currentTheme === 'dark' ? '#E4E4E7' : '#0A0A0B',
          colorTextSecondary: currentTheme === 'dark' ? '#A1A1AA' : '#3F3F46',
          colorTextTertiary: currentTheme === 'dark' ? '#71717A' : '#71717A',
          colorTextQuaternary: currentTheme === 'dark' ? '#52525B' : '#A1A1AA',
          colorBgLayout: currentTheme === 'dark' ? '#09090B' : '#FAFAFA',
        },
        components: {
          Button: { fontWeight: 500, borderRadius: 6 },
          Card: { borderRadiusLG: 8 },
          Modal: { borderRadiusLG: 8 },
          Input: { borderRadius: 6 },
          Menu: { borderRadiusLG: 6 },
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
