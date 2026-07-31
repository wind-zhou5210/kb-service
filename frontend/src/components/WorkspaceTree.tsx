import { Key } from 'react'
import { Tree } from 'antd'
import { FileTextOutlined, Html5Outlined, FolderOutlined, FolderOpenOutlined, FileOutlined } from '@ant-design/icons'
import type { WorkspaceTreeNode } from '../api/client'

interface Props {
  treeData: WorkspaceTreeNode[]
  selectedFile?: string
  onSelect: (path: string) => void
}

function toAntdTree(nodes: WorkspaceTreeNode[]): any[] {
  return nodes.map(node => {
    if (node.type === 'directory') {
      return {
        key: `dir:${node.name}`,
        title: node.name,
        icon: (props: any) => props.expanded ? <FolderOpenOutlined /> : <FolderOutlined />,
        children: node.children ? toAntdTree(node.children) : [],
        selectable: false,
      }
    }
    const isMd = node.name.endsWith('.md')
    const icon = node.is_asset
      ? <FileOutlined style={{ color: '#999' }} />
      : isMd
        ? <FileTextOutlined style={{ color: '#1677ff' }} />
        : <Html5Outlined style={{ color: '#fa8c16' }} />

    return {
      key: `file:${node.path}`,
      title: node.name,
      icon,
      isLeaf: true,
    }
  })
}

export default function WorkspaceTree({ treeData, selectedFile, onSelect }: Props) {
  const selectedKeys: Key[] = selectedFile ? [`file:${selectedFile}`] : []

  const handleSelect = (keys: Key[]) => {
    if (keys.length === 0) return
    const key = String(keys[0])
    if (key.startsWith('file:')) {
      onSelect(key.slice(5))
    }
  }

  return (
    <Tree
      treeData={toAntdTree(treeData)}
      selectedKeys={selectedKeys}
      onSelect={handleSelect}
      defaultExpandAll
      showIcon
      style={{ background: 'transparent' }}
    />
  )
}
