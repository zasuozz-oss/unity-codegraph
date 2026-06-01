# CodeGraph Unity Agent Skills

Thư mục này chứa các kỹ năng (skills) cho agent khi sử dụng CodeGraph trên dự án Unity, được định dạng theo cấu trúc chuẩn của agent skill (mỗi skill nằm trong một thư mục riêng và có file `SKILL.md`).

## Cấu trúc thư mục

```text
skills/
  codegraph-unity-exploring/
    SKILL.md
  codegraph-unity-guide/
    SKILL.md
  codegraph-unity-impact/
    SKILL.md
  codegraph-unity-refactoring/
    SKILL.md
```

## Triển khai thủ công

Copy thư mục của từng skill vào thư mục lưu trữ kỹ năng của agent bạn đang sử dụng:

- **Gemini / Antigravity**: `~/.gemini/config/skills/`
- **Claude Code**: `~/.claude/skills/`
- **Codex**: `~/.codex/skills/`

Ví dụ đối với Antigravity:
```bash
cp -r custom/skills/codegraph-unity-* ~/.gemini/config/skills/
```

Installer có thể tự động hóa bước này trong tương lai, hiện tại các skill được giữ độc lập và chuẩn hóa để đảm bảo khả năng tương thích cao nhất.
