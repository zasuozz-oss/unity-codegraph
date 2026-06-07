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

## Triển khai

`codegraph unity init` tự động copy các skill này vào project Unity đang được
index:

- `.agents/skills/<skill-name>/SKILL.md`
- `.claude/skills/<skill-name>/SKILL.md`

Các skill được cài theo từng repo để agent mở đúng project sẽ nhận đúng hướng
dẫn Unity CodeGraph mà không làm thay đổi global profile của người dùng.

Nếu cần override nguồn skill khi debug CLI, đặt biến môi trường:

```bash
CODEGRAPH_UNITY_SKILLS_DIR=/path/to/custom/skills codegraph unity init
```
