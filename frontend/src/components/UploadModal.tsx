import { useState, useEffect, useMemo } from 'react'
import { Modal, Upload, message, Button, List, Checkbox, Tag } from 'antd'
import { InboxOutlined, FileTextOutlined, Html5Outlined, DeleteOutlined, WarningOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { api } from '../api/client'
import { formatSize } from '../utils/format'

interface Props {
  collectionId: number
  open: boolean
  onClose: () => void
  onSuccess: () => void
  existingFilenames?: string[]
}

const { Dragger } = Upload
const ACCEPT = '.md,.html,.htm'

export default function UploadModal({ collectionId, open, onClose, onSuccess, existingFilenames = [] }: Props) {
  const [files, setFiles] = useState<UploadFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [overwriteMode, setOverwriteMode] = useState(false)

  // 检测已选文件中是否有与集合中现有文档同名的
  const conflictingFiles = useMemo(() => {
    return files.filter((f) => existingFilenames.includes(f.name))
  }, [files, existingFilenames])

  // 当检测到同名文件时，自动启用覆盖模式
  useEffect(() => {
    if (conflictingFiles.length > 0 && !overwriteMode) {
      setOverwriteMode(true)
    }
  }, [conflictingFiles, overwriteMode])

  const handleUpload = async () => {
    const valid = files.filter((f) => f.originFileObj)
    if (!valid.length) {
      message.warning('请先选择文件')
      return
    }
    setUploading(true)
    try {
      const result = await api.uploadDocuments(
        collectionId,
        valid.map((f) => f.originFileObj as File),
        overwriteMode ? 'overwrite' : undefined,
      )
      const createdCount = result.created?.length ?? 0
      const updatedCount = (result as any).updated?.length ?? 0
      const duplicatedCount = result.duplicated?.length ?? 0

      if (duplicatedCount > 0 && (createdCount > 0 || updatedCount > 0)) {
        message.success(
          `成功上传 ${createdCount} 个文件，覆盖 ${updatedCount} 个文件，${duplicatedCount} 个文件因内容重复已跳过`,
          4,
        )
      } else if (duplicatedCount > 0 && createdCount === 0 && updatedCount === 0) {
        message.warning(`上传失败: ${result.duplicated?.join(', ')} 与集合中已有文件内容重复`)
      } else {
        const parts = []
        if (createdCount) parts.push(`成功上传 ${createdCount} 个文件`)
        if (updatedCount) parts.push(`覆盖更新 ${updatedCount} 个文件`)
        message.success(parts.join('，') || '上传完成')
      }
      setFiles([])
      onClose()
      onSuccess()
    } catch (e: any) {
      const detail = e.response?.data?.detail
      if (detail) {
        message.error(detail, 5)
      } else {
        message.error('上传失败，请检查网络后重试')
      }
    } finally {
      setUploading(false)
    }
  }

  const removeFile = (uid: string) => {
    setFiles(files.filter((f) => f.uid !== uid))
  }

  return (
    <Modal
      title="上传文件"
      open={open}
      onCancel={() => {
        setFiles([])
        onClose()
      }}
      width={520}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="upload" type="primary" loading={uploading} onClick={handleUpload}>
          上传 {files.length > 0 && `(${files.length})`}
        </Button>,
      ]}
    >
      {conflictingFiles.length > 0 && (
        <div style={{
          marginBottom: 12, padding: '6px 12px', borderRadius: 6,
          background: 'var(--warning-tint)', border: '1px solid var(--warning-border)', fontSize: 12, color: 'var(--warning-text)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <WarningOutlined />
          <span>
            检测到 {conflictingFiles.map(f => f.name).join('、')} 已存在，将自动启用替换模式覆盖旧文档
          </span>
        </div>
      )}

      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox checked={overwriteMode} onChange={(e) => setOverwriteMode(e.target.checked)}>
          替换同名文档
        </Checkbox>
        <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>
          （选中后同文件名的文档将被覆盖，旧版本可追溯）
        </span>
      </div>

      <Dragger
        accept={ACCEPT}
        multiple
        beforeUpload={(file) => {
          // 检查是否与已选文件重复（按文件名 + 大小判断）
          const dup = files.find(
            (f) => f.name === file.name && f.size === file.size,
          )
          if (dup) {
            message.warning(`文件「${file.name}」已在待上传列表中，请勿重复添加`)
            return Upload.LIST_IGNORE
          }
          return false
        }}
        fileList={files}
        onChange={({ fileList }) => setFiles(fileList)}
        style={{ marginBottom: 16 }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ color: 'var(--accent)', fontSize: 40 }} />
        </p>
        <p style={{ fontSize: 14, color: 'var(--ink-800)', fontWeight: 500 }}>
          点击或拖拽文件到此区域
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink-400)' }}>
          支持 .md / .html / .htm 格式，可多选
        </p>
      </Dragger>

      {/* 已选文件列表 */}
      {files.length > 0 && (
        <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          {files.map((f) => {
            const isMd = f.name.endsWith('.md')
            return (
              <div
                key={f.uid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ color: isMd ? 'var(--md-color)' : 'var(--html-color)', fontSize: 16 }}>
                  {isMd ? <FileTextOutlined /> : <Html5Outlined />}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--ink-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>
                  {formatSize(f.size || 0)}
                </span>
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => removeFile(f.uid)}
                  danger
                />
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
