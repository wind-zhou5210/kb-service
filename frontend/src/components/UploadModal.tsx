import { useState } from 'react'
import { Modal, Upload, message, Button } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { api } from '../api/client'

interface Props {
  collectionId: number
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const { Dragger } = Upload

// 白名单与后端一致
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

  return (
    <Modal
      title="上传文件"
      open={open}
      onCancel={() => {
        setFiles([])
        onClose()
      }}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="upload" type="primary" loading={uploading} onClick={handleUpload}>
          上传
        </Button>,
      ]}
    >
      <Dragger
        accept={ACCEPT}
        multiple
        beforeUpload={() => false} // 阻止自动上传，手动控制
        fileList={files}
        onChange={({ fileList }) => setFiles(fileList)}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
        <p className="ant-upload-hint">支持 .md / .html / .htm 格式，可多选</p>
      </Dragger>
    </Modal>
  )
}
