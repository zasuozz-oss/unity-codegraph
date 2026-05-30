# CodeGraph Unity Agent Skills

Các file trong thư mục này là overlay kỹ năng cho agent khi dùng CodeGraph trên dự án Unity.

Triển khai thủ công bằng cách copy các file `.md` vào thư mục skill của agent đang dùng:

- Gemini / Antigravity: `~/.gemini/config/skills/`
- Claude Code: `~/.claude/skills/`
- Codex: `~/.codex/skills/`

Installer có thể tự động hóa bước này trong follow-up, nhưng hiện tại các skill được giữ độc lập để không làm đổi workflow upstream.
