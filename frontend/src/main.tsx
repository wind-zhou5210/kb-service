import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import 'highlight.js/styles/github.css'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#4F46E5',
          colorInfo: '#4F46E5',
          borderRadius: 6,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
          fontSize: 14,
          colorBorder: '#E4E4E7',
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
  </React.StrictMode>,
)
