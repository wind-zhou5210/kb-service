import Breadcrumbs from './Breadcrumbs'

interface Props {
  actions?: React.ReactNode
}

/** 详情页二级导航栏：左侧面包屑，右侧页面级操作按钮插槽 */
export default function SubNav({ actions }: Props) {
  return (
    <div className="subnav">
      <Breadcrumbs />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{actions}</div>
    </div>
  )
}
