---
name: react-project-builder
description: Guide for creating React projects with default technology stack (React + pnpm + Vite + TailwindCSS + Ant Design). Use when creating new web projects or generating frontend code.
---

# React Project Builder

This skill provides guidance for creating modern React projects with a standardized technology stack.

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
- When using `pnpm create vite`, use the full absolute path: `~/Library/Application Support/qacowork/projects/<project-name>` (expand `~` to actual home directory)

## Default Technology Stack

When creating new projects, use the following **default stack** unless the user specifies otherwise:

- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite (latest version)
- **Package Manager**: pnpm (always use `pnpm`, not npm or yarn)
- **Styling**: TailwindCSS 3.4+ for utility-first CSS
- **UI Component Library**: Ant Design (antd) for professional UI components

## Project Creation Steps

### 1. Initialize Project

**CRITICAL: You MUST create the project in the specified directory:**

```bash
# Define the base projects directory (MANDATORY)
# Use $HOME environment variable to get user's home directory dynamically
PROJECTS_DIR="$HOME/Library/Application Support/qacowork/projects"

# Ensure the directory exists
mkdir -p "$PROJECTS_DIR"

# Create Vite React TypeScript project in the specified location
cd "$PROJECTS_DIR"
pnpm create vite <project-name> --template react-ts

# Navigate to project directory
cd "$PROJECTS_DIR/<project-name>"

# Install dependencies
pnpm install
```

**Alternative using absolute path directly:**

```bash
# Create project directly in the required directory
# Use $HOME to get user's home directory dynamically
pnpm create vite "$HOME/Library/Application Support/qacowork/projects/<project-name>" --template react-ts

# Navigate to project directory
cd "$HOME/Library/Application Support/qacowork/projects/<project-name>"

# Install dependencies
pnpm install
```

### 2. Install Required Dependencies

```bash
# Install TailwindCSS and dependencies
pnpm add -D tailwindcss postcss autoprefixer
pnpm exec tailwindcss init -p

# Install Ant Design
pnpm add antd

# Install additional useful dependencies
pnpm add @ant-design/icons  # Ant Design icons
pnpm add dayjs  # Date handling (used by antd)
```

### 3. Configure TailwindCSS

Update `tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Add TailwindCSS directives to `src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 4. Configure Ant Design

Import Ant Design styles in `src/main.tsx` or `src/index.tsx`:

```typescript
import 'antd/dist/reset.css'; // or 'antd/dist/antd.css' for older versions
```

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

## Example: Creating a Complete Project

**CRITICAL: Always use the required project directory:**

```bash
# Define the mandatory projects directory
# Use $HOME environment variable to get user's home directory dynamically
PROJECTS_DIR="$HOME/Library/Application Support/qacowork/projects"
PROJECT_NAME="my-app"
PROJECT_PATH="$PROJECTS_DIR/$PROJECT_NAME"

# 1. Ensure directory exists and create project
mkdir -p "$PROJECTS_DIR"
cd "$PROJECTS_DIR"
pnpm create vite "$PROJECT_NAME" --template react-ts
cd "$PROJECT_PATH"

# 2. Install dependencies
pnpm install
pnpm add -D tailwindcss postcss autoprefixer
pnpm exec tailwindcss init -p
pnpm add antd @ant-design/icons dayjs

# 3. Configure TailwindCSS (update tailwind.config.js and src/index.css)

# 4. Import Ant Design styles in src/main.tsx
import 'antd/dist/reset.css';

# 5. Start development server
pnpm dev
```

**Or using absolute path directly:**

```bash
# 1. Create project in required location
pnpm create vite "~/Library/Application Support/qacowork/projects/my-app" --template react-ts
cd "~/Library/Application Support/qacowork/projects/my-app"

# 2. Install dependencies
pnpm install
pnpm add -D tailwindcss postcss autoprefixer
pnpm exec tailwindcss init -p
pnpm add antd @ant-design/icons dayjs

# 3. Configure TailwindCSS (update tailwind.config.js and src/index.css)

# 4. Import Ant Design styles in src/main.tsx
import 'antd/dist/reset.css';

# 5. Start development server
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
