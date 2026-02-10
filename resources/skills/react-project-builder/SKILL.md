---
name: react-project-builder
description: Guide for creating React projects with default technology stack (React + pnpm + Vite + TailwindCSS + Ant Design). Use when creating new web projects or generating frontend code.
---

# React Project Builder

This skill provides guidance for creating modern React projects with a standardized technology stack.

## Template-Based Workflow (OpenCowork)

**When user creates a NEW project via OpenCowork's "New Project" button:**
- The project is **automatically initialized from a template** (React + Vite + TailwindCSS + Ant Design)
- **Do NOT run `pnpm create vite`**—the template already has all config files
- **Only generate business code** (e.g., `src/App.tsx`, `src/components/*`) based on user requirements
- Then run `pnpm install` and `pnpm dev` in the project directory

## ⚠️ CRITICAL: Project Location Requirement

**ALL projects MUST be created in:**
```
~/Library/Application Support/qacowork/projects
```

**This is MANDATORY and cannot be changed. Always use absolute paths when creating projects.**

**Rules:**
- **ALWAYS** use this exact path when creating new projects
- **NEVER** create projects in the current working directory or any other location
- **ALWAYS** use absolute paths when specifying project location
- The project name will be appended to this base path: `~/Library/Application Support/qacowork/projects/<project-name>` (use `$HOME` environment variable or `~` in shell commands)
- **Template-based projects**: Do NOT run `pnpm create vite`; generate business code only

## Default Technology Stack

When creating new projects, use the following **default stack** unless the user specifies otherwise:

- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite (latest version)
- **Package Manager**: pnpm (always use `pnpm`, not npm or yarn)
- **Styling**: TailwindCSS 3.4+ for utility-first CSS
- **UI Component Library**: Ant Design (antd) for professional UI components

## Project Creation Steps

### A. Template-Based (OpenCowork New Project)

When the project was created via OpenCowork, the template already includes:
- package.json, vite.config.ts, tsconfig*, tailwind.config.js, postcss.config.js, eslint.config.js
- src/main.tsx (with ConfigProvider), src/App.tsx, src/index.css, src/App.css
- Ant Design, TailwindCSS, PostCSS pre-configured

**Steps:**
1. Generate business code using `write_file` (e.g., `src/App.tsx`, `src/components/*`)
2. Run `pnpm install` in the project directory
3. Run `pnpm dev` to start the development server

```bash
cd "$HOME/Library/Application Support/qacowork/projects/<project-name>"
pnpm install
pnpm dev
```

### B. Manual Creation (Non-OpenCowork)

**Use only when creating projects outside OpenCowork.**

### 1. Initialize Project

**CRITICAL: You MUST create the project in the specified directory:**

```bash
PROJECTS_DIR="$HOME/Library/Application Support/qacowork/projects"
mkdir -p "$PROJECTS_DIR"
cd "$PROJECTS_DIR"
pnpm create vite <project-name> --template react-ts
cd "$PROJECTS_DIR/<project-name>"
pnpm install
```

### 2. Install Required Dependencies

```bash
pnpm add -D tailwindcss postcss autoprefixer
pnpm exec tailwindcss init -p
pnpm add antd @ant-design/icons dayjs
```

### 3. Configure TailwindCSS

Update `tailwind.config.js` and add `@tailwind base/components/utilities` to `src/index.css`.

### 4. Configure Ant Design

Import Ant Design styles and use `ConfigProvider` with zhCN locale in `src/main.tsx`.

### 5. Project Structure

```
project-name/
├── src/
│   ├── components/      # Reusable components
│   ├── pages/          # Page components
│   ├── hooks/          # Custom React hooks
│   ├── utils/          # Utility functions
│   ├── types/          # TypeScript type definitions
│   ├── App.tsx         # Main app component
│   ├── main.tsx        # Entry point
│   └── index.css       # Global styles
├── public/             # Static assets
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

## UI/UX Best Practices

### Using Ant Design Components

- **Forms**: Use `Form`, `Input`, `Select`, `DatePicker`, etc. for consistent form UI
- **Layout**: Use `Layout`, `Row`, `Col` for responsive layouts
- **Navigation**: Use `Menu`, `Breadcrumb` for navigation
- **Feedback**: Use `message`, `notification`, `Modal` for user feedback
- **Data Display**: Use `Table`, `Card`, `List` for data presentation
- **Buttons**: Use `Button` with proper variants (primary, default, dashed, etc.)

### Styling Guidelines

- **Primary Styling**: Use Ant Design components for UI elements
- **Custom Styling**: Use TailwindCSS for custom styles, spacing, colors, animations
- **Responsive Design**: Use Ant Design's responsive grid system and TailwindCSS breakpoints
- **Theme**: Customize Ant Design theme using `ConfigProvider` when needed

### Code Quality

- Use TypeScript for type safety
- Follow React best practices (hooks, component composition)
- Ensure accessibility (use semantic HTML, ARIA attributes)
- Optimize performance (use React.memo, useMemo, useCallback when appropriate)
- Write clean, maintainable code

## Example: Creating a Complete Project (Template-Based)

**When project is created via OpenCowork (template already applied):**

```bash
PROJECT_PATH="$HOME/Library/Application Support/qacowork/projects/<project-name>"
cd "$PROJECT_PATH"

# 1. Generate business code (write_file) - src/App.tsx, src/components/*, etc.

# 2. Install dependencies and start dev server
pnpm install
pnpm dev
```

**Manual creation (outside OpenCowork):**

```bash
PROJECTS_DIR="$HOME/Library/Application Support/qacowork/projects"
cd "$PROJECTS_DIR"
pnpm create vite <project-name> --template react-ts
cd "$PROJECTS_DIR/<project-name>"
pnpm install
pnpm add -D tailwindcss postcss autoprefixer
pnpm exec tailwindcss init -p
pnpm add antd @ant-design/icons dayjs
# Configure tailwind.config.js, src/index.css, src/main.tsx
pnpm dev
```

## When to Use This Skill

- User requests to create a new web project
- User wants to generate frontend code
- User asks for a React application
- User doesn't specify a technology stack
- User wants a modern, professional UI

## When NOT to Use This Stack

- User explicitly requests a different framework (Next.js, Vue, Angular, etc.)
- User specifies a different package manager (npm, yarn)
- User wants a different UI library (Material-UI, Chakra UI, etc.)
- User requests a backend-only project
