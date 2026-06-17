"""应用配置：从环境变量读取，集中管理。"""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KB_", env_file=".env", extra="ignore")

    # 服务
    app_name: str = "文件知识管理服务"
    api_prefix: str = "/api"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4173"]

    # 鉴权
    jwt_secret: str = "changeme-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 天
    admin_username: str = "admin"
    admin_password: str = "admin123"  # 仅 MVP 默认值，生产务必修改

    # 存储
    storage_dir: Path = Path("/data/files")
    db_path: Path = Path("/data/db/kb.sqlite")

    # 上传限制
    allowed_exts: list[str] = [".md", ".html", ".htm"]
    max_upload_mb: int = 10

    @property
    def db_url(self) -> str:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{self.db_path}"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()
settings.storage_dir.mkdir(parents=True, exist_ok=True)
