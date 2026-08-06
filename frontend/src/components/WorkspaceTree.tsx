import { Key, useEffect, useMemo, useState } from 'react'
import { Tree, Input, Dropdown, message } from 'antd'
import type { MenuProps } from 'antd'
import { FileTextOutlined, Html5Outlined, FolderOutlined, FolderOpenOutlined, FileOutlined } from '@ant-design/icons'
import type { WorkspaceTreeNode } from '../api/client'
import { copyToClipboard } from '../utils/clipboard'

interface Props {
  treeData: WorkspaceTreeNode[]
  selectedFile?: string
  onSelect: (path: string) => void
  /** 传入后右键菜单启用「替换文件」（分享页不传，保持只读） */
  onReplaceFile?: (path: string) => void
  /** 传入后右键菜单启用「删除」（分享页不传，保持只读） */
  onDeleteFile?: (path: string) => void
}

// 目录 key 使用完整路径，避免同名目录 key 冲突
function toAntdTree(nodes: WorkspaceTreeNode[], parentPath = ''): any[] {
  return nodes.map(node => {
    if (node.type === 'directory') {
      const dirPath = parentPath ? `${parentPath}/${node.name}` : node.name
      return {
        key: `dir:${dirPath}`,
        title: node.name,
        icon: (props: any) => props.expanded ? <FolderOpenOutlined /> : <FolderOutlined />,
        children: node.children ? toAntdTree(node.children, dirPath) : [],
        selectable: false,
      }
    }
    const isMd = node.name.endsWith('.md')
    const icon = node.is_asset
      ? <FileOutlined style={{ color: 'var(--ink-400)' }} />
      : isMd
        ? <FileTextOutlined style={{ color: 'var(--md-color)' }} />
        : <Html5Outlined style={{ color: 'var(--html-color)' }} />

    return {
      key: `file:${node.path}`,
      title: node.name,
      icon,
      isLeaf: true,
    }
  })
}

// 按文件名过滤树，保留仍有匹配子节点的目录
function filterTree(nodes: WorkspaceTreeNode[], q: string): WorkspaceTreeNode[] {
  return nodes
    .map(n => n.type === 'directory'
      ? { ...n, children: filterTree(n.children ?? [], q) }
      : n)
    .filter(n => n.type === 'directory'
      ? (n.children?.length ?? 0) > 0
      : n.name.toLowerCase().includes(q))
}

function collectDirKeys(nodes: any[], acc: Key[] = []): Key[] {
  for (const n of nodes) {
    if (String(n.key).startsWith('dir:')) {
      acc.push(n.key)
      collectDirKeys(n.children ?? [], acc)
    }
  }
  return acc
}

export default function WorkspaceTree({ treeData, selectedFile, onSelect, onReplaceFile, onDeleteFile }: Props) {
  const [filter, setFilter] = useState('')
  const [expandedKeys, setExpandedKeys] = useState<Key[]>(() => collectDirKeys(toAntdTree(treeData)))
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null)

  // treeData 变化时（如上传新文件后）展开新出现的目录
  useEffect(() => {
    const allKeys = collectDirKeys(toAntdTree(treeData))
    setExpandedKeys(prev => {
      const merged = new Set(prev)
      for (const k of allKeys) merged.add(k)
      return Array.from(merged)
    })
  }, [treeData])

  const q = filter.trim().toLowerCase()
  const filtered = useMemo(() => (q ? filterTree(treeData, q) : treeData), [treeData, q])
  const antdData = useMemo(() => toAntdTree(filtered), [filtered])

  // 过滤时展开全部匹配目录，否则使用受控展开状态
  const effectiveExpanded = q ? collectDirKeys(antdData) : expandedKeys
  const selectedKeys: Key[] = selectedFile ? [`file:${selectedFile}`] : []

  const handleSelect = (keys: Key[]) => {
    if (keys.length === 0) return
    const key = String(keys[0])
    if (key.startsWith('file:')) {
      onSelect(key.slice(5))
    }
  }

  const copyLink = async (path: string) => {
    const ok = await copyToClipboard(`${window.location.origin}${window.location.pathname}?file=${encodeURIComponent(path)}`)
    message[ok ? 'success' : 'warning'](ok ? '链接已复制' : '复制失败')
  }

  const menuItems: MenuProps['items'] = [
    { key: 'copy', label: '复制链接' },
    ...(onReplaceFile ? [{ key: 'replace', label: '替换文件' }] : []),
    onDeleteFile
      ? { key: 'delete', label: '删除', danger: true }
      : { key: 'delete', label: '删除', danger: true, disabled: true },
  ]

  return (
    <div style={{ outline: 'none' }}>
      <Input.Search
        placeholder="过滤文件…"
        allowClear
        size="small"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: 8, padding: '0 4px' }}
      />
      <Dropdown
        open={!!ctxMenu}
        onOpenChange={(o) => { if (!o) setCtxMenu(null) }}
        trigger={['contextMenu']}
        menu={{
          items: menuItems,
          onClick: ({ key }) => {
            if (ctxMenu) {
              if (key === 'copy') copyLink(ctxMenu.path)
              else if (key === 'replace') onReplaceFile?.(ctxMenu.path)
              else if (key === 'delete') onDeleteFile?.(ctxMenu.path)
            }
            setCtxMenu(null)
          },
        }}
        overlayStyle={ctxMenu ? { position: 'fixed', left: ctxMenu.x, top: ctxMenu.y } : undefined}
      >
        <div>
          <Tree
            treeData={antdData}
            selectedKeys={selectedKeys}
            expandedKeys={effectiveExpanded}
            onExpand={(keys) => { if (!q) setExpandedKeys(keys) }}
            onSelect={handleSelect}
            onRightClick={({ event, node }) => {
              const key = String(node.key)
              if (key.startsWith('file:')) {
                event.preventDefault()
                setCtxMenu({ x: event.clientX, y: event.clientY, path: key.slice(5) })
              }
            }}
            showIcon
            blockNode
            style={{ background: 'transparent' }}
          />
        </div>
      </Dropdown>
    </div>
  )
}
