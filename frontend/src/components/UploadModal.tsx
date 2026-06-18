import { useState } from 'react'
import { Modal, Upload, message, Button, List } from 'antd'
import { InboxOutlined, FileTextOutlined, Html5Outlined, DeleteOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { api } from '../api/client'
import { formatSize } from '../utils/format'

interface Props {
  collectionId: number
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const { Dragger } = Upload
const ACCEPT = '.md,.html,.htm'

export default function UploadModal({ collectionId, open, onClose, onSuccess }: Props) {
  const [files, setFiles] = useState<UploadFile[]>([])
  const [uploading, setUploading] = useState(false)

  const handleUpload = async () => {
    const valid = files.filter((f) => f.originFileObj)
    if (!valid.length) {
      message.warning('请先选择文件')
      return
    }
    setUploading(true)
    try {
      await api.uploadDocuments(
        collectionId,
        valid.map((f) => f.originFileObj as File),
      )
      message.success(`成功上传 ${valid.length} 个文件`)
      setFiles([])
      onClose()
      onSuccess()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '上传失败')
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
      <Dragger
        accept={ACCEPT}
        multiple
        beforeUpload={() => false}
        fileList={files}
        onChange={({ fileList }) => setFiles(fileList)}
        style={{ marginBottom: 16 }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ color: 'var(--color-primary)', fontSize: 40 }} />
        </p>
        <p style={{ fontSize: 14, color: 'var(--color-text)', fontWeight: 500 }}>
          点击或拖拽文件到此区域
        </p>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          支持 .md / .html / .htm 格式，可多选
        </p>
      </Dragger>

      {/* 已选文件列表 */}
      {files.length > 0 && (
        <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 8 }}>
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
                  borderBottom: '1px solid var(--color-border-light)',
                }}
              >
                <span style={{ color: isMd ? 'var(--color-md)' : 'var(--color-html)', fontSize: 16 }}>
                  {isMd ? <FileTextOutlined /> : <Html5Outlined />}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
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
